package com.serthekk.watercat

/*
 * The self-care game's rules, as plain functions (no Android, no database): what a goal, a
 * glass of water or a good day is worth, the care streak, and what the wallet holds.
 * GameRepo applies them to the Room tables; GameRulesTest checks them.
 *
 * Two kinds of points:
 *   💧 sips  - "energy": every goal and every glass gives some. Today's sips fill the bar that
 *              sends her out exploring (step 5).
 *   🐟 treats - the currency: earned with goals and good days, spent in the shop (step 6).
 *
 * Every reward is a ledger entry with a unique key (e.g. "goal:12:2026-11-27"). Granting
 * the same key twice does nothing; taking a goal back removes its entry. So checking,
 * unchecking and re-checking can never pay twice, and the balance is always the sum.
 */

/** One ledger entry: what was earned (or spent: negative) and why. */
data class Reward(val key: String, val date: String, val sips: Int, val treats: Int, val note: String)

object GameRules {
    const val SIPS_PER_GLASS = 2
    const val DEFAULT_GOAL_SIPS = 5
    const val TREATS_PER_GOAL = 2
    const val WATER_GOAL_SIPS = 10 // the day's water goal reached
    const val WATER_GOAL_TREATS = 5
    const val ALL_GOALS_TREATS = 5 // every goal of the day checked
    val STREAK_MILESTONES = mapOf(3 to 5, 7 to 15, 14 to 25, 30 to 50, 60 to 80, 100 to 120) // days -> treats
    const val ADVENTURE_SIPS = 30 // today's sips that send her exploring (step 5)

    fun goalReward(goalId: Long, sips: Int, title: String, date: String) =
        Reward("goal:$goalId:$date", date, sips, TREATS_PER_GOAL, title)

    /**
     * The rewards a day's glasses should have: one per glass ("glass:<date>:<n>") and the
     * water-goal bonus once the goal is reached. Cups logged on the computer count too.
     */
    fun waterRewards(date: String, cups: Int, goal: Int): List<Reward> {
        val out = (1..cups.coerceIn(0, 100)).map { Reward("glass:$date:$it", date, SIPS_PER_GLASS, 0, "Glass of water") }
        return if (goal in 1..cups) out + Reward("water:$date", date, WATER_GOAL_SIPS, WATER_GOAL_TREATS, "Water goal reached") else out
    }

    fun allGoalsReward(date: String) = Reward("allgoals:$date", date, 0, ALL_GOALS_TREATS, "Every goal done")

    fun milestoneReward(days: Int, date: String): Reward? =
        STREAK_MILESTONES[days]?.let { Reward("streak:$days:$date", date, 0, it, "$days-day care streak") }

    /** Which keys to add and which to remove so a day's water rewards match the cups. Only the water keys of that day are touched. */
    fun waterDiff(date: String, cups: Int, goal: Int, existingKeys: Set<String>): Pair<List<Reward>, Set<String>> {
        val want = waterRewards(date, cups, goal)
        val wantKeys = want.map { it.key }.toSet()
        val mine = existingKeys.filter { it.startsWith("glass:$date:") || it == "water:$date" }.toSet()
        return want.filter { it.key !in existingKeys } to (mine - wantKeys)
    }

    data class Wallet(val treats: Int, val sipsToday: Int, val sipsTotal: Int)

    fun wallet(entries: List<Reward>, today: String) = Wallet(
        treats = entries.sumOf { it.treats },
        sipsToday = entries.filter { it.date == today }.sumOf { it.sips },
        sipsTotal = entries.sumOf { it.sips },
    )

    fun canAfford(entries: List<Reward>, price: Int) = entries.sumOf { it.treats } >= price

    /**
     * The care streak: days in a row with at least one thing done (a goal checked or a glass
     * of water). Today counts once something is done; until then the streak runs to
     * yesterday, so it is never "lost" before the day is over.
     *
     * A missed day is handled kindly: the streak starts over, the best stays, and [welcomeBack]
     * is true for the first day after a gap so the app can say something nice instead.
     */
    data class Streak(val current: Int, val best: Int, val doneToday: Boolean, val welcomeBack: Boolean, val missedDays: Int)

    fun careStreak(activeDays: Set<String>, today: String, previousBest: Int = 0): Streak {
        val doneToday = today in activeDays
        var day = if (doneToday) today else dayBefore(today)
        var n = 0
        while (day in activeDays && n < 10_000) { n++; day = dayBefore(day) }
        // the longest run ever (also from days the phone still knows)
        var best = previousBest
        val sorted = activeDays.sorted()
        var run = 0
        var prev: String? = null
        for (d in sorted) {
            run = if (prev != null && dayBefore(d) == prev) run + 1 else 1
            best = maxOf(best, run)
            prev = d
        }
        val last = sorted.lastOrNull { it < today }
        val missed = if (last == null) 0 else daysBetween(last, today) - 1
        return Streak(n, maxOf(best, n), doneToday, welcomeBack = missed > 0 && n <= 1, missedDays = missed.coerceAtLeast(0))
    }

    /** What she says on the home screen about the streak: never a scolding. */
    fun streakLine(s: Streak, catName: String): String = when {
        s.welcomeBack && s.missedDays == 1 -> "Welcome back! $catName missed you yesterday 💛 Let's start a fresh streak together."
        s.welcomeBack -> "Welcome back! $catName saved you a cozy spot 💛 Every sip today counts."
        s.current == 0 -> "Do one little thing today to start a streak ✨"
        !s.doneToday -> "${s.current} day streak: one little thing today keeps it going 🌱"
        s.current >= s.best && s.current > 1 -> "${s.current} day streak: your longest ever! 🎉"
        else -> "${s.current} day streak ☀️"
    }

    private fun parse(d: String) = java.time.LocalDate.parse(d)
    fun dayBefore(d: String): String = parse(d).minusDays(1).toString()
    fun daysBetween(a: String, b: String): Int = java.time.temporal.ChronoUnit.DAYS.between(parse(a), parse(b)).toInt()
}

/** The starter plan: easy goals for a first day (all can be edited, reordered or removed). */
object StarterPlan {
    data class Item(val title: String, val icon: String, val kind: String = "custom")

    val items = listOf(
        Item("Drink water", "💧", kind = "water"), // done when the day's water goal is reached
        Item("Brush teeth", "🪥"),
        Item("Take a stretch break", "🧘"),
        Item("Take 3 deep breaths", "🌬️"),
        Item("Get out of bed", "🛏️"),
        Item("Do one thing that makes me happy", "😊"),
    )
}
