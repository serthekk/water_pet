package com.serthekk.watercat

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class GameRulesTest {
    private val today = "2026-11-27"

    // --- sips (energy) + treats (currency) ----------------------------------------------
    @Test fun glassesAndTheWaterGoalPayOncePerDay() {
        val r = GameRules.waterRewards(today, cups = 3, goal = 8)
        assertEquals(3, r.size)
        assertEquals(6, r.sumOf { it.sips })
        assertEquals(0, r.sumOf { it.treats })
        val full = GameRules.waterRewards(today, cups = 8, goal = 8)
        assertEquals(8 * 2 + 10, full.sumOf { it.sips })
        assertEquals(5, full.sumOf { it.treats })
        assertEquals(full.size, full.map { it.key }.toSet().size) // every key unique
        assertEquals(full, GameRules.waterRewards(today, 8, 8)) // the same day gives the same keys
    }

    @Test fun waterDiffAddsNewGlassesAndTakesBackUndoneOnes() {
        val have = GameRules.waterRewards(today, 8, 8).map { it.key }.toSet() + "goal:1:$today" + "glass:2026-11-26:1"
        val (add, remove) = GameRules.waterDiff(today, cups = 6, goal = 8, existingKeys = have) // two undone, goal no longer met
        assertTrue(add.isEmpty())
        assertEquals(setOf("glass:$today:7", "glass:$today:8", "water:$today"), remove)
        val (add2, remove2) = GameRules.waterDiff(today, cups = 9, goal = 8, existingKeys = have)
        assertEquals(listOf("glass:$today:9"), add2.map { it.key })
        assertTrue(remove2.isEmpty()) // other days and goals are never touched
        val (add3, remove3) = GameRules.waterDiff(today, cups = 8, goal = 8, existingKeys = have)
        assertTrue(add3.isEmpty() && remove3.isEmpty()) // nothing twice
    }

    @Test fun walletSumsTheLedger() {
        val entries = GameRules.waterRewards(today, 8, 8) +
            GameRules.goalReward(1, 5, "Brush teeth", today) +
            GameRules.goalReward(2, 5, "Stretch", "2026-11-26") +
            Reward("shop:bow", today, 0, -6, "Bought a bow")
        val w = GameRules.wallet(entries, today)
        assertEquals(5 + 2 + 2 - 6, w.treats)
        assertEquals(8 * 2 + 10 + 5, w.sipsToday)
        assertEquals(8 * 2 + 10 + 5 + 5, w.sipsTotal)
        assertTrue(GameRules.canAfford(entries, 3))
        assertFalse(GameRules.canAfford(entries, 4))
    }

    @Test fun goalRewardsAndMilestones() {
        val g = GameRules.goalReward(42, 7, "Take 3 deep breaths", today)
        assertEquals("goal:42:$today", g.key)
        assertEquals(7, g.sips)
        assertEquals(GameRules.TREATS_PER_GOAL, g.treats)
        assertEquals(15, GameRules.milestoneReward(7, today)!!.treats)
        assertNull(GameRules.milestoneReward(8, today))
        assertEquals("allgoals:$today", GameRules.allGoalsReward(today).key)
    }

    // --- the care streak ---------------------------------------------------------------
    private fun days(vararg d: String) = d.toSet()

    @Test fun streakCountsDaysInARowAndTodayOnlyOnceDone() {
        val s = GameRules.careStreak(days("2026-11-24", "2026-11-25", "2026-11-26"), today)
        assertEquals(3, s.current) // today not done yet: runs to yesterday, not lost
        assertFalse(s.doneToday)
        assertFalse(s.welcomeBack)
        val s2 = GameRules.careStreak(days("2026-11-24", "2026-11-25", "2026-11-26", today), today)
        assertEquals(4, s2.current)
        assertEquals(4, s2.best)
        assertTrue(s2.doneToday)
    }

    @Test fun aMissedDayIsHandledKindly() {
        val back = GameRules.careStreak(days("2026-11-20", "2026-11-21", "2026-11-22", "2026-11-23", "2026-11-25"), today)
        assertEquals(0, back.current) // 26th missed: yesterday wasn't done
        assertEquals(4, back.best) // the best run is kept
        assertTrue(back.welcomeBack)
        assertEquals(1, back.missedDays)
        assertTrue(GameRules.streakLine(back, "Gargorl").startsWith("Welcome back!"))
        val backToday = GameRules.careStreak(days("2026-11-20", today), today)
        assertEquals(1, backToday.current)
        assertTrue(backToday.welcomeBack)
        assertEquals(6, backToday.missedDays)
        assertFalse(GameRules.streakLine(backToday, "Gargorl").contains("lost", ignoreCase = true))
        val fresh = GameRules.careStreak(emptySet(), today)
        assertEquals(0, fresh.current)
        assertFalse(fresh.welcomeBack) // a new user is not "back"
    }

    @Test fun bestStreakSurvivesForgottenDaysAndMonthEnds() {
        val s = GameRules.careStreak(days("2026-10-30", "2026-10-31", "2026-11-01", today), today, previousBest = 12)
        assertEquals(12, s.best)
        assertEquals(1, s.current)
        val acrossMonths = GameRules.careStreak(days("2026-02-27", "2026-02-28", "2026-03-01"), "2026-03-01")
        assertEquals(3, acrossMonths.current)
        assertEquals("2026-02-28", GameRules.dayBefore("2026-03-01"))
    }

    @Test fun streakLines() {
        assertEquals("5 day streak: your longest ever! 🎉", GameRules.streakLine(GameRules.Streak(5, 5, true, false, 0), "G"))
        assertTrue(GameRules.streakLine(GameRules.Streak(5, 9, false, false, 0), "G").contains("keeps it going"))
    }

    @Test fun starterPlanHasTheEasyGoals() {
        assertEquals(listOf("Drink water", "Brush teeth", "Take a stretch break", "Take 3 deep breaths", "Get out of bed", "Do one thing that makes me happy"),
            StarterPlan.items.map { it.title })
        assertEquals(1, StarterPlan.items.count { it.kind == "water" })
    }
}
