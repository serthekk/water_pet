package com.serthekk.watercat

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.net.wifi.WifiManager
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.isActive
import kotlinx.coroutines.withContext
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetSocketAddress
import java.net.SocketTimeoutException

/**
 * "Sync now" from the computer (sync.js): when the PC starts, wakes up or comes home it
 * broadcasts "WATERCAT_HERE 1 <its id> up", and before it quits / shuts down "... bye".
 * While the app is open we listen for that and sync right away (instead of at the next
 * minute); before a normal quit the PC waits a few seconds for exactly this sync.
 *
 * A nudge carries no data and proves nothing: it only starts the normal sync, which
 * checks the computer's proof first. Only our own computer's id counts.
 *
 * Also: whenever the phone joins a Wi-Fi network, a sync is asked for a few seconds later
 * (SyncClient.sync itself checks that it's the home Wi-Fi), so cups catch up as soon as
 * she gets home, not only at the next 15-minute background run.
 */
object SyncNudges {
    const val PORT = 47825
    private const val PREFIX = "WATERCAT_HERE 1 "

    /** "WATERCAT_HERE 1 <id> up|bye" for our computer -> "up" / "bye", else null. */
    fun parse(text: String, desktopId: String): String? {
        val t = text.trim()
        if (!t.startsWith(PREFIX) || t.length > 64) return null
        val parts = t.removePrefix(PREFIX).split(' ')
        if (parts.size != 2 || parts[1] !in setOf("up", "bye")) return null
        if (desktopId.isNotEmpty() && parts[0] != desktopId) return null // another computer (or another account on it)
        return parts[1]
    }

    /**
     * Listens until the coroutine is cancelled (the app goes to the background) and calls
     * [onNudge] for each nudge from our computer. Never throws: without the socket the phone
     * simply syncs every minute as before.
     */
    suspend fun listen(ctx: Context, onNudge: (String) -> Unit) = withContext(Dispatchers.IO) {
        val wifi = ctx.applicationContext.getSystemService(WifiManager::class.java)
        // many phones drop broadcast packets unless an app holds a multicast lock
        val mlock = runCatching { wifi?.createMulticastLock("watercat-nudge")?.apply { setReferenceCounted(false); acquire() } }.getOrNull()
        val sock = runCatching {
            DatagramSocket(null).apply { reuseAddress = true; broadcast = true; soTimeout = 1000; bind(InetSocketAddress(PORT)) }
        }.getOrNull()
        try {
            if (sock == null) return@withContext
            val buf = ByteArray(128)
            while (isActive) {
                val p = DatagramPacket(buf, buf.size)
                try {
                    sock.receive(p)
                } catch (_: SocketTimeoutException) {
                    continue
                } catch (_: Exception) {
                    break
                }
                val s = Store.get(ctx).now
                if (!s.paired) continue
                parse(String(p.data, 0, p.length), s.desktopId)?.let(onNudge)
            }
        } finally {
            runCatching { sock?.close() }
            runCatching { mlock?.release() }
        }
    }

    /** From WaterCatApp: a sync soon after the phone joins any Wi-Fi (while the app's process lives). */
    fun watchWifi(ctx: Context) {
        val cm = ctx.applicationContext.getSystemService(ConnectivityManager::class.java) ?: return
        val req = NetworkRequest.Builder().addTransportType(NetworkCapabilities.TRANSPORT_WIFI).build()
        runCatching {
            cm.registerNetworkCallback(req, object : ConnectivityManager.NetworkCallback() {
                override fun onAvailable(network: Network) {
                    if (Store.get(ctx).now.paired) SyncWorker.syncSoon(ctx)
                }
            })
        }
    }
}
