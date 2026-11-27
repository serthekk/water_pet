package com.serthekk.watercat

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test
import java.net.HttpURLConnection
import java.net.URL

/**
 * Talks to a real desktop sync.js. Skipped unless WATERCAT_E2E_PORT and WATERCAT_E2E_CODE
 * are set (start sync.js with a fake main first, see android/README.md).
 */
class DesktopE2ETest {
    private fun post(port: Int, path: String, body: ByteArray, headers: Map<String, String> = emptyMap()): Triple<Int, JSONObject, Pair<ByteArray, String?>> {
        val c = URL("http://127.0.0.1:$port$path").openConnection() as HttpURLConnection
        c.requestMethod = "POST"; c.doOutput = true
        c.setRequestProperty("Content-Type", "application/json")
        headers.forEach { (k, v) -> c.setRequestProperty(k, v) }
        c.outputStream.use { it.write(body) }
        val code = c.responseCode
        val raw = (if (code < 300) c.inputStream else c.errorStream).readBytes()
        return Triple(code, JSONObject(String(raw)), raw to c.getHeaderField("X-WaterCat-Proof"))
    }

    /** challenge -> check the computer's proof -> signed sync -> check the answer's proof */
    private fun signedSync(port: Int, s: State, now: Long): Pair<Int, JSONObject> {
        val c = SyncProtocol.newChallenge()
        val (cs, ch) = post(port, "/watercat/challenge", JSONObject().put("deviceId", s.deviceId).put("c", c).toString().toByteArray())
        if (cs != 200) return cs to ch
        val nonce = ch.getString("nonce")
        assertTrue("computer proof", SyncProtocol.serverProofOk(s.key, c, nonce, ch.getString("proof")))
        val body = SyncProtocol.request(s, now, "JVM").toString().toByteArray()
        val (st, r, extra) = post(port, "/watercat/sync", body, mapOf("X-WaterCat-Device" to s.deviceId, "X-WaterCat-Nonce" to nonce, "X-WaterCat-Sig" to SyncProtocol.signature(s.key, nonce, body)))
        if (st == 200) assertTrue("answer proof", SyncProtocol.answerProofOk(s.key, nonce, extra.first, extra.second))
        return st to r
    }

    @Test fun pairAndSyncWithTheDesktop() {
        val port = System.getenv("WATERCAT_E2E_PORT")?.toIntOrNull()
        val code = System.getenv("WATERCAT_E2E_CODE")
        assumeTrue(port != null && code != null)
        val now = System.currentTimeMillis()
        val today = dayKey(now)
        val (st, pr) = post(port!!, "/watercat/pair", JSONObject().put("code", code).put("deviceId", "android-e2e-test").put("deviceName", "JVM").toString().toByteArray())
        assertEquals(200, st)
        val key = SyncProtocol.deriveKey(pr.getString("token"))

        // the phone logged 3 cups and changed the goal to 10 (newer than anything on the desktop)
        val phone = State(deviceId = "android-e2e-test", mine = mapOf(today to 3), goalCups = 10, stamps = mapOf("goalCups" to now - 1000), key = key, desktopId = pr.getString("id"))
        val (s1, r1) = signedSync(port, phone, now)
        assertEquals(200, s1)
        val merged = SyncProtocol.apply(phone, phone, r1, now)
        assertEquals(5, merged.total(today)) // 2 from the desktop + 3 from the phone
        assertEquals(10, merged.goalCups) // the phone's newer goal won
        assertEquals("pill", merged.alarms.single().id) // the desktop's alarm came over
        assertEquals("Gargorl on E2E", merged.desktopName)

        // one more cup on the phone, then an undo of two: only the differences reach the desktop
        val p2 = merged.copy(mine = mapOf(today to 4))
        val m2 = SyncProtocol.apply(p2, p2, signedSync(port, p2, now).second, now)
        assertEquals(6, m2.total(today))
        val p3 = m2.copy(mine = mapOf(today to 2))
        val m3 = SyncProtocol.apply(p3, p3, signedSync(port, p3, now).second, now)
        assertEquals(4, m3.total(today))
        // a phone with a wrong key: the computer's proof fails, so it would send nothing
        val wrong = p3.copy(key = SyncProtocol.deriveKey("not-the-token"))
        val c = SyncProtocol.newChallenge()
        val ch = post(port, "/watercat/challenge", JSONObject().put("deviceId", wrong.deviceId).put("c", c).toString().toByteArray()).second
        assertFalse(SyncProtocol.serverProofOk(wrong.key, c, ch.getString("nonce"), ch.getString("proof")))
        assertEquals(401, post(port, "/watercat/sync", "{}".toByteArray(), mapOf("X-WaterCat-Device" to wrong.deviceId, "X-WaterCat-Nonce" to "00", "X-WaterCat-Sig" to "00")).first)
    }
}
