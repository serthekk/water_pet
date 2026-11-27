package com.serthekk.watercat

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AdventuresTest {
    private val today = "2026-11-27"
    private val t0 = 1_000_000_000L
    private fun trip(claimed: Boolean = false, date: String = today) = Adventures.Trip(1, date, t0, t0 + Adventures.TRIP_MS, 3, 10, claimed)

    @Test fun statusThroughTheDay() {
        assertEquals(Adventures.Status.NotEnoughEnergy, Adventures.status(29, today, null, t0))
        assertEquals(Adventures.Status.Ready, Adventures.status(30, today, null, t0))
        val away = Adventures.status(30, today, trip(), t0 + Adventures.TRIP_MS / 4) as Adventures.Status.Away
        assertEquals(Adventures.TRIP_MS * 3 / 4, away.remainingMs)
        assertEquals(0.25f, away.progress, 0.0001f)
        assertEquals(Adventures.Status.Back, Adventures.status(30, today, trip(), t0 + Adventures.TRIP_MS))
        assertEquals(Adventures.Status.DoneToday, Adventures.status(99, today, trip(claimed = true), t0 + Adventures.TRIP_MS))
    }

    @Test fun theTimerKeepsGoingAcrossRestartsAndDays() {
        // nothing but the stored times decide: a "restart" an hour later sees the same countdown
        val a = Adventures.status(30, today, trip(), t0 + 3_600_000) as Adventures.Status.Away
        assertEquals(Adventures.TRIP_MS - 3_600_000, a.remainingMs)
        // yesterday's trip, never welcomed: she is still waiting at the door today
        assertEquals(Adventures.Status.Back, Adventures.status(0, today, trip(date = "2026-11-26"), t0 + 30 * 3_600_000L))
        // yesterday's welcomed trip doesn't block today's
        assertEquals(Adventures.Status.Ready, Adventures.status(30, today, null, t0))
    }

    @Test fun countdownFormat() {
        assertEquals("6:53:23", Adventures.countdown((6 * 3600 + 53 * 60 + 23) * 1000L))
        assertEquals("0:00:01", Adventures.countdown(1)) // never shows 0 while she is still out
        assertEquals("0:00:00", Adventures.countdown(-5))
        assertEquals("3:00:00", Adventures.countdown(Adventures.TRIP_MS))
    }

    @Test fun storiesRewardsAndPronouns() {
        val s = Adventures.pickStory(42, emptyList())
        assertEquals(s, Adventures.pickStory(42, emptyList())) // the same trip, the same story
        val recent = Adventures.STORIES.map { it.id }.take(6)
        assertFalse(Adventures.pickStory(42, recent).id in recent) // no repeats of the last six
        assertTrue((0L..200L).all { Adventures.treatsFor(it) in 8..15 })
        val told = Adventures.tell(Adventures.STORIES[4], "Fainu", "unspecified")
        assertEquals("A squirrel dropped something on Fainu's head under the big oak. They kept it, obviously.", told)
        assertTrue(Adventures.tell(Adventures.STORIES[2], "Gargorl", "female").contains("her fur"))
        assertTrue(Adventures.STORIES.none { "{" in Adventures.tell(it, "X", "male") })
        assertEquals("adventure:1", Adventures.reward(trip()).key)
        assertEquals(10, Adventures.reward(trip()).treats)
        assertEquals(Adventures.STORIES.size, Adventures.STORIES.map { it.id }.toSet().size)
    }
}
