package com.serthekk.watercat

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assume.assumeTrue
import org.junit.Test
import java.net.HttpURLConnection
import java.net.URL

/**
 * Talks to a real desktop sync.js. Skipped unless WATERCAT_E2E_PORT and WATERCAT_E2E_CODE
 * are set (start sync.js with a fake main first, see android/README.md).
 */
class DesktopE2ETest {
    private fun post(port: Int, path: String, body: JSONObject, token: String? = null): Pair<Int, JSONObject> {
        val c = URL("http://127.0.0.1:$port$path").openConnection() as HttpURLConnection
        c.requestMethod = "POST"; c.doOutput = true
        c.setRequestProperty("Content-Type", "application/json")
        if (token != null) c.setRequestProperty("Authorization", "Bearer $token")
        c.outputStream.use { it.write(body.toString().toByteArray()) }
        val code = c.responseCode
        val text = (if (code < 300) c.inputStream else c.errorStream).bufferedReader().readText()
        return code to JSONObject(text)
    }

    @Test fun pairAndSyncWithTheDesktop() {
        val port = System.getenv("WATERCAT_E2E_PORT")?.toIntOrNull()
        val code = System.getenv("WATERCAT_E2E_CODE")
        assumeTrue(port != null && code != null)
        val now = System.currentTimeMillis()
        val today = dayKey(now)
        val (st, pr) = post(port!!, "/watercat/pair", JSONObject().put("code", code).put("deviceId", "android-e2e-test").put("deviceName", "JVM"))
        assertEquals(200, st)
        val token = pr.getString("token")

        // the phone logged 3 cups and changed the goal to 10 (newer than anything on the desktop)
        val phone = State(deviceId = "android-e2e-test", mine = mapOf(today to 3), goalCups = 10, stamps = mapOf("goalCups" to now - 1000), token = token)
        val (s1, r1) = post(port, "/watercat/sync", SyncProtocol.request(phone, now, "JVM"), token)
        assertEquals(200, s1)
        val merged = SyncProtocol.apply(phone, phone, r1, now)
        assertEquals(5, merged.total(today)) // 2 from the desktop + 3 from the phone
        assertEquals(10, merged.goalCups) // the phone's newer goal won
        assertEquals("pill", merged.alarms.single().id) // the desktop's alarm came over
        assertEquals("Gargorl on E2E", merged.desktopName)

        // one more cup on the phone, then an undo of two: only the differences reach the desktop
        val p2 = merged.copy(mine = mapOf(today to 4))
        val m2 = SyncProtocol.apply(p2, p2, post(port, "/watercat/sync", SyncProtocol.request(p2, now, "JVM"), token).second, now)
        assertEquals(6, m2.total(today))
        val p3 = m2.copy(mine = mapOf(today to 2))
        val m3 = SyncProtocol.apply(p3, p3, post(port, "/watercat/sync", SyncProtocol.request(p3, now, "JVM"), token).second, now)
        assertEquals(4, m3.total(today))
        assertEquals(401, post(port, "/watercat/sync", JSONObject(), "0".repeat(64)).first)
    }
}
