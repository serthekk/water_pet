package com.serthekk.watercat

import android.content.Context
import android.net.wifi.WifiManager
import android.os.Build
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.HttpURLConnection
import java.net.InetAddress
import java.net.NetworkInterface
import java.net.SocketTimeoutException
import java.net.URL
import java.util.concurrent.TimeUnit

/** Talks to the desktop app's sync.js over the local Wi-Fi. */
object SyncClient {
    const val HTTP_PORT = 47823
    const val DISCOVERY_PORT = 47824
    private const val DISCOVER_MSG = "WATERCAT_DISCOVER 1"
    private val lock = Mutex()

    data class Computer(val name: String, val host: String, val port: Int)
    class SyncException(msg: String) : Exception(msg)

    fun deviceName(): String = (Build.MODEL ?: "Android phone").take(40)

    /** Broadcasts on the Wi-Fi and collects the answers of WaterCat computers (about 2 s). */
    suspend fun discover(ctx: Context): List<Computer> = withContext(Dispatchers.IO) {
        val wifi = ctx.applicationContext.getSystemService(WifiManager::class.java)
        val mlock = wifi?.createMulticastLock("watercat-discovery")?.apply { setReferenceCounted(false); acquire() }
        val found = LinkedHashMap<String, Computer>()
        try {
            DatagramSocket().use { sock ->
                sock.broadcast = true
                sock.soTimeout = 400
                val msg = DISCOVER_MSG.toByteArray()
                val targets = broadcastAddresses() + InetAddress.getByName("255.255.255.255")
                val until = System.currentTimeMillis() + 2200
                var round = 0
                while (System.currentTimeMillis() < until) {
                    if (round++ % 3 == 0) for (t in targets) runCatching { sock.send(DatagramPacket(msg, msg.size, t, DISCOVERY_PORT)) }
                    val buf = ByteArray(1024)
                    val p = DatagramPacket(buf, buf.size)
                    try {
                        sock.receive(p)
                        val o = JSONObject(String(p.data, 0, p.length))
                        if (o.optString("app") == "WaterCat") {
                            val host = p.address.hostAddress ?: continue
                            found[host] = Computer(o.optString("name", host), host, o.optInt("port", HTTP_PORT))
                        }
                    } catch (_: SocketTimeoutException) {
                    } catch (_: Exception) {
                    }
                }
            }
        } finally {
            runCatching { mlock?.release() }
        }
        found.values.toList()
    }

    private fun broadcastAddresses(): List<InetAddress> = runCatching {
        NetworkInterface.getNetworkInterfaces().toList()
            .filter { it.isUp && !it.isLoopback }
            .flatMap { it.interfaceAddresses }
            .mapNotNull { it.broadcast }
    }.getOrDefault(emptyList())

    /** "192.168.1.20" or "192.168.1.20:47823" -> host + port. */
    fun parseAddress(text: String): Pair<String, Int>? {
        val t = text.trim().removePrefix("http://").trimEnd('/')
        if (t.isEmpty()) return null
        val host = t.substringBefore(':')
        val port = if (':' in t) t.substringAfter(':').toIntOrNull() ?: return null else HTTP_PORT
        if (!Regex("^[A-Za-z0-9.-]{1,253}$").matches(host) || port !in 1..65535) return null
        return host to port
    }

    private fun post(host: String, port: Int, path: String, body: JSONObject?, token: String?): Pair<Int, JSONObject> {
        val c = URL("http", host, port, path).openConnection() as HttpURLConnection
        try {
            c.connectTimeout = 4000
            c.readTimeout = 8000
            c.useCaches = false
            if (body != null) {
                c.requestMethod = "POST"
                c.doOutput = true
                c.setRequestProperty("Content-Type", "application/json; charset=utf-8")
            }
            if (token != null) c.setRequestProperty("Authorization", "Bearer $token")
            if (body != null) c.outputStream.use { it.write(body.toString().toByteArray()) }
            val code = c.responseCode
            val text = (if (code in 200..299) c.inputStream else c.errorStream)?.bufferedReader()?.use { it.readText() } ?: "{}"
            return code to runCatching { JSONObject(text) }.getOrDefault(JSONObject())
        } finally {
            c.disconnect()
        }
    }

    private fun friendly(e: Exception): String = when (e) {
        is SyncException -> e.message ?: "Sync failed"
        is SocketTimeoutException, is java.net.ConnectException, is java.net.NoRouteToHostException ->
            "Can't reach the computer. Is it on, on the same Wi-Fi, with Phone sync turned on?"
        is java.net.UnknownHostException -> "Unknown address"
        else -> "Sync failed (${e.javaClass.simpleName})"
    }

    suspend fun pair(ctx: Context, host: String, port: Int, code: String): Result<String> = withContext(Dispatchers.IO) {
        val store = Store.get(ctx)
        try {
            val body = JSONObject().put("code", code.filter { it.isDigit() }).put("deviceId", store.now.deviceId).put("deviceName", deviceName())
            val (status, r) = post(host, port, "/watercat/pair", body, null)
            if (status != 200) throw SyncException(r.optString("error", "Pairing failed ($status)"))
            val token = r.optString("token")
            if (token.length < 32) throw SyncException("The computer sent a bad answer")
            store.update { it.copy(host = host, port = port, token = token, desktopName = r.optString("name", host), syncError = "") }
            schedulePeriodicSafe(ctx)
            sync(ctx).getOrThrow()
            Result.success(r.optString("name", host))
        } catch (e: Exception) {
            Result.failure(SyncException(friendly(e)))
        }
    }

    suspend fun unpair(ctx: Context) = withContext(Dispatchers.IO) {
        val s = Store.get(ctx).now
        if (s.paired) runCatching { post(s.host, s.port, "/watercat/unpair", JSONObject(), s.token) }
        Store.get(ctx).update { it.copy(token = "", syncError = "", lastSync = 0) }
        WorkManager.getInstance(ctx).cancelUniqueWork(SyncWorker.PERIODIC)
    }

    /** One sync: send this phone's cups + settings, merge the answer, reschedule. */
    suspend fun sync(ctx: Context): Result<Unit> = withContext(Dispatchers.IO) {
        lock.withLock {
            val store = Store.get(ctx)
            val sent = store.now
            if (!sent.paired) return@withLock Result.failure(SyncException("Not paired"))
            val todayBefore = sent.total(dayKey(System.currentTimeMillis()))
            try {
                val now = System.currentTimeMillis()
                val (status, r) = post(sent.host, sent.port, "/watercat/sync", SyncProtocol.request(sent, now, deviceName()), sent.token)
                if (status == 401) {
                    store.update { it.copy(token = "", syncError = "The computer forgot this phone. Pair again.") }
                    WorkManager.getInstance(ctx).cancelUniqueWork(SyncWorker.PERIODIC)
                    throw SyncException("The computer forgot this phone. Pair again.")
                }
                if (status != 200) throw SyncException(r.optString("error", "Sync failed ($status)"))
                val before = store.now
                val after = store.update { SyncProtocol.apply(it, sent, r, System.currentTimeMillis()) }
                val today = dayKey(System.currentTimeMillis())
                // a drink logged on the computer also counts here: the reminder starts over
                val drankElsewhere = after.total(today) > todayBefore && (after.mine[today] ?: 0) == (sent.mine[today] ?: 0)
                if (drankElsewhere) {
                    store.update { it.copy(nagging = false, nextReminderAt = System.currentTimeMillis() + it.reminderMinutes * 60_000L) }
                    Notifications.cancelReminder(ctx)
                }
                val reminderChanged = listOf("reminderMinutes", "quietStart", "quietEnd", "remindersPausedUntil").any { before.stamps[it] != after.stamps[it] }
                if (reminderChanged && !after.nagging) store.update { it.copy(nextReminderAt = System.currentTimeMillis() + it.reminderMinutes * 60_000L) }
                if (after.remindersPaused(System.currentTimeMillis()) && after.nagging) {
                    store.update { it.copy(nagging = false) }
                    Notifications.cancelReminder(ctx)
                }
                Scheduler.rescheduleAll(ctx)
                Result.success(Unit)
            } catch (e: Exception) {
                val msg = friendly(e)
                store.update { it.copy(syncError = msg) }
                Result.failure(SyncException(msg))
            }
        }
    }

    private fun schedulePeriodicSafe(ctx: Context) = runCatching { SyncWorker.schedulePeriodic(ctx) }
}

class SyncWorker(ctx: Context, params: WorkerParameters) : CoroutineWorker(ctx, params) {
    override suspend fun doWork(): Result {
        if (!Store.get(applicationContext).now.paired) return Result.success()
        SyncClient.sync(applicationContext) // errors are shown in the app; the next run tries again
        return Result.success()
    }

    companion object {
        const val PERIODIC = "sync-periodic"
        private const val SOON = "sync-soon"
        private val wifi = Constraints.Builder().setRequiredNetworkType(NetworkType.UNMETERED).build()

        fun schedulePeriodic(ctx: Context) {
            val req = PeriodicWorkRequestBuilder<SyncWorker>(15, TimeUnit.MINUTES).setConstraints(wifi).build()
            WorkManager.getInstance(ctx).enqueueUniquePeriodicWork(PERIODIC, ExistingPeriodicWorkPolicy.KEEP, req)
        }

        /** A sync a few seconds from now (several quick changes make one sync). */
        fun syncSoon(ctx: Context) {
            if (!Store.get(ctx).now.paired) return
            val req = OneTimeWorkRequestBuilder<SyncWorker>().setInitialDelay(3, TimeUnit.SECONDS)
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()).build()
            WorkManager.getInstance(ctx).enqueueUniqueWork(SOON, ExistingWorkPolicy.REPLACE, req)
        }
    }
}
