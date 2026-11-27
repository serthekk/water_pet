package com.serthekk.watercat

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class SyncProtocolTest {
    private val now = 1_763_640_000_000L // 2025-11-20
    private val today = dayKey(now)

    @Test fun totalsAddPhoneCupsLoggedSinceTheLastSync() {
        val s = State(base = mapOf(today to 5), baseMine = mapOf(today to 2), mine = mapOf(today to 4))
        assertEquals(7, s.total(today)) // 5 from the desktop (2 of them mine) + 2 new ones here
        assertEquals(3, State(mine = mapOf(today to 3)).total(today)) // never synced
    }

    @Test fun requestCarriesCupsAndStampedSettings() {
        val s = State(deviceId = "android-x", goalCups = 9, stamps = mapOf("goalCups" to 123L), mine = mapOf(today to 2, "2000-01-01" to 4),
            alarms = listOf(Alarm("a1", "07:30", "Wake up")))
        val r = SyncProtocol.request(s, now, "Pixel")
        assertEquals(2, r.getJSONObject("cups").getInt(today))
        assertFalse(r.getJSONObject("cups").has("2000-01-01"))
        assertEquals(9, r.getJSONObject("settings").getJSONObject("goalCups").getInt("v"))
        assertEquals(123L, r.getJSONObject("settings").getJSONObject("goalCups").getLong("t"))
        assertEquals("07:30", r.getJSONObject("settings").getJSONObject("alarms").getJSONArray("v").getJSONObject(0).getString("time"))
    }

    private fun answer(goal: Int, goalT: Long) = JSONObject()
        .put("name", "Gargorl on PC").put("streak", 4).put("catName", "Gargorl").put("drinkWord", "cups")
        .put("totals", JSONObject().put(today, 6)).put("mine", JSONObject().put(today, 2)).put("goals", JSONObject().put(today, goal))
        .put("settings", JSONObject()
            .put("goalCups", JSONObject().put("v", goal).put("t", goalT))
            .put("alarms", JSONObject().put("v", JSONArray().put(JSONObject().put("id", "pill").put("time", "22:00").put("text", "Pill").put("enabled", true))).put("t", 50L))
            .put("quietStart", JSONObject().put("v", "bad").put("t", 60L)))

    @Test fun answerIsMerged() {
        val sent = State(mine = mapOf(today to 2))
        val s = SyncProtocol.apply(sent, sent, answer(10, 99L), now)
        assertEquals(10, s.goalCups)
        assertEquals(99L, s.stamps["goalCups"])
        assertEquals("pill", s.alarms.single().id)
        assertEquals("23:00", s.quietStart) // invalid value ignored
        assertEquals(6, s.total(today))
        assertEquals("Gargorl on PC", s.desktopName)
        assertEquals(now, s.lastSync)
    }

    @Test fun anEditDuringTheRequestIsKept() {
        val sent = State(goalCups = 8, stamps = mapOf("goalCups" to 10L))
        val cur = sent.copy(goalCups = 12, stamps = mapOf("goalCups" to 20L), mine = mapOf(today to 3)) // edited + a cup while syncing
        val s = SyncProtocol.apply(cur, sent, answer(10, 10L), now)
        assertEquals(12, s.goalCups)
        assertEquals(20L, s.stamps["goalCups"])
        assertEquals(7, s.total(today)) // 6 (with my 2) + the 1 logged during the request
    }

    @Test fun quietHoursWrapPastMidnight() {
        assertTrue(isQuietAt(23 * 60 + 30, "23:00", "08:00"))
        assertTrue(isQuietAt(7 * 60, "23:00", "08:00"))
        assertFalse(isQuietAt(8 * 60, "23:00", "08:00"))
        assertFalse(isQuietAt(12 * 60, "12:00", "12:00"))
        assertTrue(isQuietAt(13 * 60, "12:00", "14:00"))
    }

    @Test fun reminderMovesOutOfQuietHoursAndPause() {
        val cal = java.util.Calendar.getInstance().apply { timeInMillis = now; set(java.util.Calendar.HOUR_OF_DAY, 23); set(java.util.Calendar.MINUTE, 30) }
        val at = Scheduler.adjustReminderTime(State(), cal.timeInMillis)
        val c = java.util.Calendar.getInstance().apply { timeInMillis = at }
        assertEquals(8, c.get(java.util.Calendar.HOUR_OF_DAY))
        assertEquals(0, c.get(java.util.Calendar.MINUTE))
        assertTrue(at > cal.timeInMillis)
        val paused = State(quietStart = "00:00", quietEnd = "00:00", remindersPausedUntil = now + 3_600_000)
        assertEquals(now + 3_600_000, Scheduler.adjustReminderTime(paused, now))
    }

    @Test fun streakCountsDaysWithTheGoalReached() {
        val y = dayKey(addDays(now, -1)); val y2 = dayKey(addDays(now, -2)); val y3 = dayKey(addDays(now, -3))
        val s = State(goalCups = 2, mine = mapOf(today to 1, y to 2, y2 to 3, y3 to 0), goals = mapOf(y to 2, y2 to 2, y3 to 2))
        assertEquals(2, s.streak(now)) // today not reached yet: yesterday + the day before
        assertEquals(3, s.copy(mine = s.mine + (today to 2)).streak(now))
    }

    @Test fun alarmsRoundTripAndRejectBadLists() {
        val list = listOf(Alarm("a", "7:05".let { "07:05" }, "x"), Alarm("b", "22:00", "y", false))
        assertEquals(list, Alarm.listFromJson(Alarm.listToJson(list)))
        val dup = JSONArray().put(list[0].toJson()).put(list[0].toJson())
        assertEquals(null, Alarm.listFromJson(dup))
        assertEquals(null, Alarm.listFromJson(JSONArray().put(JSONObject().put("id", "a").put("time", "25:00").put("text", "x"))))
    }

    @Test fun stateSurvivesJson() {
        val s = State(goalCups = 9, alarms = listOf(Alarm("a", "07:00", "x")), mine = mapOf(today to 2), stamps = mapOf("goalCups" to 5L), token = "t", scheduledAlarmIds = setOf("a"))
        assertEquals(s, State.fromJson(JSONObject(s.toJson().toString())))
    }

    @Test fun addressParsing() {
        assertEquals("192.168.1.5" to 47823, SyncClient.parseAddress(" 192.168.1.5 "))
        assertEquals("192.168.1.5" to 5000, SyncClient.parseAddress("http://192.168.1.5:5000/"))
        assertEquals(null, SyncClient.parseAddress("192.168.1.5:abc"))
        assertEquals(null, SyncClient.parseAddress(""))
    }
}
