package com.serthekk.watercat

import org.json.JSONArray
import org.json.JSONObject
import java.util.Calendar
import kotlin.math.max

/** A daily alarm, the same shape as the desktop app's settings.alarms entries. */
data class Alarm(val id: String, val time: String, val text: String, val enabled: Boolean = true) {
    val hour: Int get() = time.substringBefore(':').toIntOrNull() ?: 0
    val minute: Int get() = time.substringAfter(':').toIntOrNull() ?: 0

    fun toJson(): JSONObject = JSONObject().put("id", id).put("time", time).put("text", text).put("enabled", enabled)

    companion object {
        private val ID_RE = Regex("^[\\w-]{1,40}$")
        private val TIME_RE = Regex("^([01]?\\d|2[0-3]):[0-5]\\d$")

        fun fromJson(o: JSONObject): Alarm? {
            val id = o.optString("id")
            val time = o.optString("time")
            val text = o.optString("text").replace(Regex("\\s+"), " ").trim()
            if (!ID_RE.matches(id) || !TIME_RE.matches(time) || text.isEmpty() || text.length > 120) return null
            return Alarm(id, hhmm(time.substringBefore(':').toInt(), time.substringAfter(':').toInt()), text, o.optBoolean("enabled", true))
        }

        fun listFromJson(a: JSONArray?): List<Alarm>? {
            if (a == null || a.length() > MAX_ALARMS) return null
            val out = ArrayList<Alarm>()
            for (i in 0 until a.length()) out += fromJson(a.optJSONObject(i) ?: return null) ?: return null
            return if (out.map { it.id }.toSet().size == out.size) out else null
        }

        fun listToJson(list: List<Alarm>) = JSONArray().apply { list.forEach { put(it.toJson()) } }

        fun newId(): String = "p" + (1..10).map { "abcdefghijklmnopqrstuvwxyz0123456789".random() }.joinToString("")

        const val MAX_ALARMS = 20
    }
}

fun hhmm(h: Int, m: Int) = "%02d:%02d".format(h, m)
fun toMinutes(t: String) = (t.substringBefore(':').toIntOrNull() ?: 0) * 60 + (t.substringAfter(':').toIntOrNull() ?: 0)

fun dayKey(ms: Long): String {
    val c = Calendar.getInstance().apply { timeInMillis = ms }
    return "%04d-%02d-%02d".format(c.get(Calendar.YEAR), c.get(Calendar.MONTH) + 1, c.get(Calendar.DAY_OF_MONTH))
}

fun addDays(ms: Long, days: Int): Long = Calendar.getInstance().apply { timeInMillis = ms; add(Calendar.DAY_OF_MONTH, days) }.timeInMillis

/** Quiet window [start, end), wrapping past midnight. start == end = no quiet hours. */
fun isQuietAt(minuteOfDay: Int, start: String, end: String): Boolean {
    val s = toMinutes(start)
    val e = toMinutes(end)
    if (s == e) return false
    return if (s < e) minuteOfDay in s until e else minuteOfDay >= s || minuteOfDay < e
}

/** The fields that sync with the desktop app (newest change wins, per field). Keep in step with sync.js SYNC_FIELDS. */
val SYNC_FIELDS = listOf("goalCups", "reminderMinutes", "repeatMinutes", "quietStart", "quietEnd", "alarms", "remindersPausedUntil")

/**
 * Everything the app keeps (one JSON blob in SharedPreferences).
 *
 * Cups: [mine] are the cups logged on THIS phone per day. After a sync, [base] holds the
 * desktop's totals per day (phone cups included) and [baseMine] the phone cups the desktop
 * had counted, so the total for a day is base + (mine - baseMine).
 */
data class State(
    // synced with the desktop
    val goalCups: Int = 8,
    val reminderMinutes: Int = 60,
    val repeatMinutes: Int = 5,
    val quietStart: String = "23:00",
    val quietEnd: String = "08:00",
    val alarms: List<Alarm> = emptyList(),
    val remindersPausedUntil: Long = 0,
    val stamps: Map<String, Long> = emptyMap(), // field -> when it was last changed (0 / missing = never)
    // this phone only
    val remindOnPhone: Boolean = true,
    val ringAlarms: Boolean = true,
    val mine: Map<String, Int> = emptyMap(),
    val base: Map<String, Int> = emptyMap(),
    val baseMine: Map<String, Int> = emptyMap(),
    val goals: Map<String, Int> = emptyMap(), // the goal on past days (from the desktop / when logged here)
    val nextReminderAt: Long = 0,
    val nagging: Boolean = false, // a reminder is showing and repeats until a cup is logged
    val scheduledAlarmIds: Set<String> = emptySet(),
    val partyShownDate: String = "", // the goal party plays once a day
    // pairing
    val deviceId: String = "",
    val host: String = "",
    val port: Int = 47823,
    val key: String = "", // derived from the pairing token (SyncProtocol.deriveKey); the token itself is never kept
    val desktopId: String = "", // the computer's random id: finds it again after its address / port changed
    val homeSsid: String = "", // sync only happens on this Wi-Fi
    val offHome: Boolean = false, // the last sync attempt found another network (changes wait on the phone)
    val desktopName: String = "",
    val lastSync: Long = 0,
    val syncError: String = "",
    val desktopStreak: Int = 0,
    val catName: String = "WaterCat",
    val drinkWord: String = "cups",
) {
    val paired get() = key.isNotEmpty()

    fun total(date: String): Int = max(0, (base[date] ?: 0) + (mine[date] ?: 0) - (baseMine[date] ?: 0))
    fun goalOn(date: String, today: String): Int = if (date == today) goalCups else goals[date] ?: goalCups

    /** Days in a row with the goal reached (today counts once reached). */
    fun streak(now: Long): Int {
        val today = dayKey(now)
        var t = if (total(today) >= goalCups) now else addDays(now, -1)
        var n = 0
        while (n < 400) {
            val k = dayKey(t)
            if (total(k) < goalOn(k, today) || (total(k) == 0)) break
            n++
            t = addDays(t, -1)
        }
        // the phone only knows ~60 days; the desktop knows the whole streak
        return if (n >= 59) max(n, desktopStreak) else n
    }

    fun remindersPaused(now: Long) = remindersPausedUntil > now

    fun toJson(): JSONObject = JSONObject().apply {
        put("goalCups", goalCups); put("reminderMinutes", reminderMinutes); put("repeatMinutes", repeatMinutes)
        put("quietStart", quietStart); put("quietEnd", quietEnd); put("alarms", Alarm.listToJson(alarms))
        put("remindersPausedUntil", remindersPausedUntil); put("stamps", mapJson(stamps))
        put("remindOnPhone", remindOnPhone); put("ringAlarms", ringAlarms)
        put("mine", mapJson(mine)); put("base", mapJson(base)); put("baseMine", mapJson(baseMine)); put("goals", mapJson(goals))
        put("nextReminderAt", nextReminderAt); put("nagging", nagging); put("scheduledAlarmIds", JSONArray(scheduledAlarmIds.toList())); put("partyShownDate", partyShownDate)
        put("deviceId", deviceId); put("host", host); put("port", port); put("key", key); put("desktopId", desktopId); put("homeSsid", homeSsid); put("offHome", offHome); put("desktopName", desktopName)
        put("lastSync", lastSync); put("syncError", syncError); put("desktopStreak", desktopStreak)
        put("catName", catName); put("drinkWord", drinkWord)
    }

    companion object {
        fun fromJson(o: JSONObject): State {
            val d = State()
            return State(
                goalCups = o.optInt("goalCups", d.goalCups).coerceIn(1, 100),
                reminderMinutes = o.optInt("reminderMinutes", d.reminderMinutes).coerceIn(1, 1440),
                repeatMinutes = o.optInt("repeatMinutes", d.repeatMinutes).coerceIn(1, 120),
                quietStart = o.optString("quietStart", d.quietStart),
                quietEnd = o.optString("quietEnd", d.quietEnd),
                alarms = Alarm.listFromJson(o.optJSONArray("alarms")) ?: d.alarms,
                remindersPausedUntil = o.optLong("remindersPausedUntil", 0),
                stamps = longMap(o.optJSONObject("stamps")),
                remindOnPhone = o.optBoolean("remindOnPhone", true),
                ringAlarms = o.optBoolean("ringAlarms", true),
                mine = intMap(o.optJSONObject("mine")),
                base = intMap(o.optJSONObject("base")),
                baseMine = intMap(o.optJSONObject("baseMine")),
                goals = intMap(o.optJSONObject("goals")),
                nextReminderAt = o.optLong("nextReminderAt", 0),
                nagging = o.optBoolean("nagging", false),
                scheduledAlarmIds = o.optJSONArray("scheduledAlarmIds")?.let { a -> (0 until a.length()).map { a.optString(it) }.toSet() } ?: emptySet(),
                partyShownDate = o.optString("partyShownDate", ""),
                deviceId = o.optString("deviceId", ""),
                host = o.optString("host", ""),
                port = o.optInt("port", 47823),
                key = o.optString("key", ""), // (a pairing from the first version had a "token": pair again)
                desktopId = o.optString("desktopId", ""),
                homeSsid = o.optString("homeSsid", ""),
                offHome = o.optBoolean("offHome", false),
                desktopName = o.optString("desktopName", ""),
                lastSync = o.optLong("lastSync", 0),
                syncError = o.optString("syncError", ""),
                desktopStreak = o.optInt("desktopStreak", 0),
                catName = o.optString("catName", d.catName),
                drinkWord = o.optString("drinkWord", d.drinkWord),
            )
        }

        fun mapJson(m: Map<String, Number>) = JSONObject().apply { m.forEach { (k, v) -> put(k, v) } }
        fun intMap(o: JSONObject?): Map<String, Int> = o?.keys()?.asSequence()?.associateWith { o.optInt(it) } ?: emptyMap()
        fun longMap(o: JSONObject?): Map<String, Long> = o?.keys()?.asSequence()?.associateWith { o.optLong(it) } ?: emptyMap()
    }
}

/** The sync protocol (desktop sync.js), kept free of Android classes so it can be unit tested. */
object SyncProtocol {
    const val CUP_DAYS = 120

    // --- signing (desktop sync.js: deriveKey / hmac / sha256) ---
    fun sha256(b: ByteArray): String = java.security.MessageDigest.getInstance("SHA-256").digest(b).joinToString("") { "%02x".format(it) }
    fun deriveKey(token: String) = sha256("watercat-key:$token".toByteArray())
    fun hmac(key: String, msg: String): String {
        val mac = javax.crypto.Mac.getInstance("HmacSHA256")
        mac.init(javax.crypto.spec.SecretKeySpec(key.toByteArray(), "HmacSHA256"))
        return mac.doFinal(msg.toByteArray()).joinToString("") { "%02x".format(it) }
    }
    fun newChallenge(): String = ByteArray(16).also { java.security.SecureRandom().nextBytes(it) }.joinToString("") { "%02x".format(it) }
    fun serverProofOk(key: String, c: String, nonce: String, proof: String) = constantEq(hmac(key, "srv:$c:$nonce"), proof)
    fun signature(key: String, nonce: String, body: ByteArray) = hmac(key, "cli:$nonce:${sha256(body)}")
    fun answerProofOk(key: String, nonce: String, answer: ByteArray, proof: String?) = proof != null && constantEq(hmac(key, "resp:$nonce:${sha256(answer)}"), proof)
    private fun constantEq(a: String, b: String) = java.security.MessageDigest.isEqual(a.toByteArray(), b.toByteArray())

    fun request(s: State, now: Long, deviceName: String): JSONObject {
        val settings = JSONObject()
        for (k in SYNC_FIELDS) {
            val v: Any = when (k) {
                "goalCups" -> s.goalCups
                "reminderMinutes" -> s.reminderMinutes
                "repeatMinutes" -> s.repeatMinutes
                "quietStart" -> s.quietStart
                "quietEnd" -> s.quietEnd
                "alarms" -> Alarm.listToJson(s.alarms)
                else -> s.remindersPausedUntil
            }
            settings.put(k, JSONObject().put("v", v).put("t", s.stamps[k] ?: 0L))
        }
        val oldest = dayKey(addDays(now, -CUP_DAYS + 1))
        val cups = JSONObject()
        s.mine.filterKeys { it >= oldest }.forEach { (k, v) -> cups.put(k, v) }
        return JSONObject().put("now", now).put("deviceId", s.deviceId).put("deviceName", deviceName).put("cups", cups).put("settings", settings)
    }

    /**
     * Merge the desktop's answer into the current state. [sent] is the state the request was
     * built from: a field edited on the phone while the request was on its way keeps the
     * phone's value (it syncs next time).
     */
    fun apply(cur: State, sent: State, r: JSONObject, now: Long): State {
        var s = cur
        val settings = r.optJSONObject("settings") ?: JSONObject()
        val stamps = s.stamps.toMutableMap()
        for (k in SYNC_FIELDS) {
            val e = settings.optJSONObject(k) ?: continue
            if ((cur.stamps[k] ?: 0L) != (sent.stamps[k] ?: 0L)) continue
            val t = e.optLong("t", 0)
            s = when (k) {
                "goalCups" -> e.optInt("v", s.goalCups).takeIf { it in 1..100 }?.let { s.copy(goalCups = it) } ?: s
                "reminderMinutes" -> e.optInt("v", s.reminderMinutes).takeIf { it in 1..1440 }?.let { s.copy(reminderMinutes = it) } ?: s
                "repeatMinutes" -> e.optInt("v", s.repeatMinutes).takeIf { it in 1..120 }?.let { s.copy(repeatMinutes = it) } ?: s
                "quietStart" -> e.optString("v").takeIf { TIME.matches(it) }?.let { s.copy(quietStart = it) } ?: s
                "quietEnd" -> e.optString("v").takeIf { TIME.matches(it) }?.let { s.copy(quietEnd = it) } ?: s
                "alarms" -> Alarm.listFromJson(e.optJSONArray("v"))?.let { s.copy(alarms = it) } ?: s
                else -> s.copy(remindersPausedUntil = e.optLong("v", 0).coerceAtLeast(0))
            }
            stamps[k] = t
        }
        val goals = s.goals.toMutableMap()
        r.optJSONObject("goals")?.let { g -> g.keys().forEach { goals[it] = g.optInt(it) } }
        val oldest = dayKey(addDays(now, -CUP_DAYS))
        return s.copy(
            stamps = stamps,
            base = State.intMap(r.optJSONObject("totals")),
            baseMine = State.intMap(r.optJSONObject("mine")),
            goals = goals.filterKeys { it >= oldest },
            mine = s.mine.filterKeys { it >= oldest },
            desktopName = r.optString("name", s.desktopName),
            desktopStreak = r.optInt("streak", s.desktopStreak),
            catName = r.optString("catName", s.catName).ifBlank { s.catName },
            drinkWord = r.optString("drinkWord", s.drinkWord).ifBlank { s.drinkWord },
            lastSync = now,
            syncError = "",
            offHome = false,
        )
    }

    private val TIME = Regex("^([01]\\d|2[0-3]):[0-5]\\d$")
}
