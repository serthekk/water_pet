package com.serthekk.watercat

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.location.LocationManager
import android.net.wifi.WifiManager
import android.os.Build
import androidx.core.content.ContextCompat
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

    data class Computer(val name: String, val host: String, val port: Int, val id: String = "")
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
                            found["$host:${o.optInt("port", HTTP_PORT)}"] = Computer(o.optString("name", host), host, o.optInt("port", HTTP_PORT), o.optString("id"))
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

    private class Answer(val status: Int, val json: JSONObject, val raw: ByteArray, val proof: String?)

    private fun post(host: String, port: Int, path: String, body: ByteArray, headers: Map<String, String> = emptyMap()): Answer {
        val c = URL("http", host, port, path).openConnection() as HttpURLConnection
        try {
            c.connectTimeout = 4000
            c.readTimeout = 8000
            c.useCaches = false
            c.requestMethod = "POST"
            c.doOutput = true
            c.setRequestProperty("Content-Type", "application/json; charset=utf-8")
            headers.forEach { (k, v) -> c.setRequestProperty(k, v) }
            c.outputStream.use { it.write(body) }
            val code = c.responseCode
            val raw = (if (code in 200..299) c.inputStream else c.errorStream)?.use { it.readBytes() } ?: ByteArray(0)
            return Answer(code, runCatching { JSONObject(String(raw)) }.getOrDefault(JSONObject()), raw, c.getHeaderField("X-WaterCat-Proof"))
        } finally {
            c.disconnect()
        }
    }

    private fun post(host: String, port: Int, path: String, body: JSONObject) = post(host, port, path, body.toString().toByteArray())

    private fun friendly(e: Exception): String = when (e) {
        is SyncException -> e.message ?: "Sync failed"
        is SocketTimeoutException, is java.net.ConnectException, is java.net.NoRouteToHostException ->
            "Can't reach the computer. Is it on, at home, with Phone sync turned on?"
        is java.net.UnknownHostException -> "Unknown address"
        else -> "Sync failed (${e.javaClass.simpleName})"
    }

    /** Pairing makes the Wi-Fi the phone is on now its home Wi-Fi. */
    suspend fun pair(ctx: Context, host: String, port: Int, code: String): Result<String> = withContext(Dispatchers.IO) {
        val store = Store.get(ctx)
        try {
            val ssid = HomeWifi.currentSsid(ctx)
                ?: throw SyncException(HomeWifi.whyNoSsid(ctx))
            val body = JSONObject().put("code", code.filter { it.isDigit() }).put("deviceId", store.now.deviceId).put("deviceName", deviceName())
            val r = post(host, port, "/watercat/pair", body)
            if (r.status != 200) throw SyncException(r.json.optString("error", "Pairing failed (${r.status})"))
            val token = r.json.optString("token")
            if (token.length < 32 || r.json.optInt("protocol") < 2) throw SyncException("Update WaterCat on the computer first")
            store.update {
                // a new pairing: the computer's cat comes to the phone (not the other way round)
                it.copy(host = host, port = port, key = SyncProtocol.deriveKey(token), desktopId = r.json.optString("id"), homeSsid = ssid,
                    desktopName = r.json.optString("name", host), syncError = "", offHome = false, stamps = it.stamps - "cat")
            }
            schedulePeriodicSafe(ctx)
            sync(ctx).getOrThrow()
            Result.success(r.json.optString("name", host))
        } catch (e: Exception) {
            Result.failure(SyncException(friendly(e)))
        }
    }

    /** Forgets the computer. It is told too, but only from home (otherwise it forgets this phone itself later). */
    suspend fun unpair(ctx: Context) = withContext(Dispatchers.IO) {
        val s = Store.get(ctx).now
        if (s.paired && HomeWifi.check(ctx, s.homeSsid) == HomeWifi.Where.HOME) runCatching { signedCall(ctx, s, "/watercat/unpair", "{}".toByteArray(), allowFind = false) }
        Store.get(ctx).update { it.copy(key = "", desktopId = "", syncError = "", lastSync = 0, offHome = false) }
        WorkManager.getInstance(ctx).cancelUniqueWork(SyncWorker.PERIODIC)
    }

    private class Forgotten : Exception()
    private class NotMine : Exception()

    /**
     * Challenge + signed request. The computer must prove it holds this phone's key before
     * anything is sent; its answer must carry a valid proof too. If the computer at the
     * saved address is gone (or is another one, e.g. another Windows account), the phone
     * looks for its own computer on the Wi-Fi by id.
     */
    private suspend fun signedCall(ctx: Context, s: State, path: String, body: ByteArray, allowFind: Boolean = true): JSONObject {
        try {
            return signedCallAt(s, s.host, s.port, path, body)
        } catch (e: Forgotten) {
            throw e
        } catch (e: Exception) {
            if (!allowFind || (e !is NotMine && e !is java.io.IOException)) throw e
            val mine = discover(ctx).firstOrNull { it.id.isNotEmpty() && it.id == s.desktopId } ?: throw e
            val r = signedCallAt(s, mine.host, mine.port, path, body)
            Store.get(ctx).update { it.copy(host = mine.host, port = mine.port) } // it moved: remember the new address
            return r
        }
    }

    private fun signedCallAt(s: State, host: String, port: Int, path: String, body: ByteArray): JSONObject {
        val c = SyncProtocol.newChallenge()
        val ch = post(host, port, "/watercat/challenge", JSONObject().put("deviceId", s.deviceId).put("c", c))
        val id = ch.json.optString("id")
        if (ch.status == 404) throw NotMine() // not a WaterCat (or an old one) at that address
        if (s.desktopId.isNotEmpty() && id.isNotEmpty() && id != s.desktopId) throw NotMine()
        if (ch.status == 401) throw Forgotten()
        if (ch.status != 200) throw SyncException(ch.json.optString("error", "Sync failed (${ch.status})"))
        val nonce = ch.json.optString("nonce")
        if (!SyncProtocol.serverProofOk(s.key, c, nonce, ch.json.optString("proof"))) throw NotMine()
        val r = post(host, port, path, body, mapOf(
            "X-WaterCat-Device" to s.deviceId, "X-WaterCat-Nonce" to nonce, "X-WaterCat-Sig" to SyncProtocol.signature(s.key, nonce, body)))
        if (r.status == 401) throw Forgotten()
        if (r.status != 200) throw SyncException(r.json.optString("error", "Sync failed (${r.status})"))
        if (!SyncProtocol.answerProofOk(s.key, nonce, r.raw, r.proof)) throw SyncException("The computer's answer didn't check out")
        return r.json
    }

    /** One sync: send this phone's cups + settings, merge the answer, reschedule. Only on the home Wi-Fi. */
    suspend fun sync(ctx: Context): Result<Unit> = withContext(Dispatchers.IO) {
        lock.withLock {
            val store = Store.get(ctx)
            val sent = store.now
            if (!sent.paired) return@withLock Result.failure(SyncException("Not paired"))
            val where = HomeWifi.check(ctx, sent.homeSsid)
            if (where != HomeWifi.Where.HOME) {
                // not home (or Android won't say which Wi-Fi this is): nothing leaves the phone
                store.update { it.copy(offHome = true, syncError = if (where == HomeWifi.Where.UNKNOWN) HomeWifi.whyNoSsid(ctx) else "") }
                return@withLock Result.failure(SyncException(if (where == HomeWifi.Where.UNKNOWN) HomeWifi.whyNoSsid(ctx) else "Not on your home Wi-Fi: everything is saved on this phone and syncs when you're home"))
            }
            val todayBefore = sent.total(dayKey(System.currentTimeMillis()))
            try {
                val now = System.currentTimeMillis()
                val r = signedCall(ctx, sent, "/watercat/sync", SyncProtocol.request(sent, now, deviceName()).toString().toByteArray())
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
            } catch (e: Forgotten) {
                val msg = "The computer forgot this phone. Pair again."
                store.update { it.copy(key = "", syncError = msg) }
                WorkManager.getInstance(ctx).cancelUniqueWork(SyncWorker.PERIODIC)
                Result.failure(SyncException(msg))
            } catch (e: NotMine) {
                val msg = "Your computer isn't answering (another device is at its address). Is WaterCat running with Phone sync on?"
                store.update { it.copy(syncError = msg, offHome = false) }
                Result.failure(SyncException(msg))
            } catch (e: Exception) {
                val msg = friendly(e)
                store.update { it.copy(syncError = msg, offHome = false) }
                Result.failure(SyncException(msg))
            }
        }
    }

    private fun schedulePeriodicSafe(ctx: Context) = runCatching { SyncWorker.schedulePeriodic(ctx) }
}

/** Which Wi-Fi the phone is on. Android only tells apps the Wi-Fi name with location permission. */
object HomeWifi {
    enum class Where { HOME, OTHER, UNKNOWN }

    fun hasPermission(ctx: Context) =
        ContextCompat.checkSelfPermission(ctx, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED

    private fun locationOn(ctx: Context): Boolean {
        val lm = ctx.getSystemService(LocationManager::class.java) ?: return true
        return Build.VERSION.SDK_INT < 28 || lm.isLocationEnabled
    }

    /** The Wi-Fi name, or null (not on Wi-Fi, no permission, location off, or Android won't say). */
    @Suppress("DEPRECATION")
    fun currentSsid(ctx: Context): String? {
        if (!hasPermission(ctx)) return null
        val wifi = ctx.applicationContext.getSystemService(WifiManager::class.java) ?: return null
        val info = wifi.connectionInfo ?: return null
        val ssid = info.ssid?.removeSurrounding("\"")?.trim() ?: return null
        return if (ssid.isEmpty() || ssid == "<unknown ssid>" || ssid == "0x") null else ssid
    }

    @Suppress("DEPRECATION")
    private fun onWifi(ctx: Context): Boolean {
        val wifi = ctx.applicationContext.getSystemService(WifiManager::class.java) ?: return false
        return wifi.isWifiEnabled && (wifi.connectionInfo?.networkId ?: -1) != -1
    }

    fun check(ctx: Context, home: String): Where {
        if (home.isEmpty()) return Where.UNKNOWN
        val ssid = currentSsid(ctx) ?: return if (hasPermission(ctx) && locationOn(ctx) && !onWifi(ctx)) Where.OTHER else Where.UNKNOWN
        return if (ssid == home) Where.HOME else Where.OTHER
    }

    fun whyNoSsid(ctx: Context): String = when {
        !hasPermission(ctx) -> "Allow location (\"Precise\") so WaterCat can check it's your home Wi-Fi. It never uses where you are."
        !locationOn(ctx) -> "Turn on Location so WaterCat can read the Wi-Fi name (Android needs it for that)."
        else -> "Couldn't read the Wi-Fi name. Open WaterCat at home to sync."
    }
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
