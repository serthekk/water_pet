package com.serthekk.watercat

import android.content.Context
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/**
 * The game, on top of GameDb: goals, rewards, the wallet and the care streak. Applies
 * GameRules; every change goes through one lock, so a tap and a sync never race.
 * App-wide (created in WaterCatApp); keeps the water rewards in step with the cups.
 */
class GameRepo private constructor(ctx: Context) {
    private val db = GameDb.get(ctx)
    private val store = Store.get(ctx)
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val lock = Mutex()

    init {
        scope.launch {
            ensureStarterPlan()
            // cups logged here, undone, or synced from the computer -> glass rewards + water goal
            store.state.map { s -> recentDays().map { d -> Triple(d, s.total(d), s.goalOn(d, today())) } }
                .distinctUntilChanged()
                .collect { days -> for ((d, cups, goal) in days) syncWater(d, cups, goal) }
        }
    }

    private fun today() = dayKey(System.currentTimeMillis())
    private fun recentDays() = (0..2).map { dayKey(addDays(System.currentTimeMillis(), -it)) } // late syncs of the last days

    // --- flows for the screens ------------------------------------------------------
    val goals: Flow<List<GoalEntity>> = db.goals().observeActive()
    fun completions(date: String): Flow<Set<Long>> = db.completions().observeFor(date).map { l -> l.map { it.goalId }.toSet() }
    val ledger: Flow<List<Reward>> = db.ledger().observeAll().map { l -> l.map { it.toReward() } }
    val inventory: Flow<List<InventoryEntity>> = db.inventory().observe()

    fun streak(today: String): Flow<GameRules.Streak> =
        combine(db.ledger().observeActiveDays(), db.meta().observe(BEST)) { days, best ->
            GameRules.careStreak(days.toSet(), today, best?.toIntOrNull() ?: 0)
        }

    // --- goals ----------------------------------------------------------------------
    suspend fun ensureStarterPlan() = lock.withLock {
        if (db.meta().get(SEEDED) != null) return@withLock
        StarterPlan.items.forEachIndexed { i, it -> db.goals().insert(GoalEntity(title = it.title, icon = it.icon, kind = it.kind, position = i)) }
        db.meta().put(MetaEntity(SEEDED, "1"))
        if (db.meta().get(ADOPTED) == null) db.meta().put(MetaEntity(ADOPTED, today()))
    }

    /** Checks / unchecks a goal for a day. Returns the reward when it was just checked (null otherwise). Water goals follow the cups. */
    suspend fun toggle(goal: GoalEntity, date: String = today()): Reward? = lock.withLock {
        if (goal.kind == "water") return@withLock null
        val done = db.completions().forDate(date).any { it.goalId == goal.id }
        if (done) {
            db.completions().delete(goal.id, date)
            db.ledger().deleteKeys(listOf("goal:${goal.id}:$date", "allgoals:$date"))
            null
        } else {
            db.completions().insert(CompletionEntity(goal.id, date))
            val r = GameRules.goalReward(goal.id, goal.sips, goal.title, date)
            db.ledger().insert(LedgerEntity.of(r))
            afterActivity(date)
            r
        }
    }

    suspend fun addGoal(title: String, icon: String, sips: Int = GameRules.DEFAULT_GOAL_SIPS): Long = lock.withLock {
        db.goals().insert(GoalEntity(title = title.trim().take(60), icon = icon.ifBlank { "⭐" }, sips = sips.coerceIn(1, 20), position = db.goals().nextPosition()))
    }

    suspend fun editGoal(goal: GoalEntity, title: String, icon: String, sips: Int) = lock.withLock {
        db.goals().update(goal.copy(title = title.trim().take(60).ifBlank { goal.title }, icon = icon.ifBlank { goal.icon }, sips = sips.coerceIn(1, 20)))
    }

    /** Removed goals are archived: what they earned stays in the wallet. */
    suspend fun removeGoal(goal: GoalEntity) = lock.withLock { db.goals().update(goal.copy(archived = true)) }

    /** New order (ids top to bottom). */
    suspend fun reorder(ids: List<Long>) = lock.withLock {
        val byId = db.goals().active().associateBy { it.id }
        db.goals().updateAll(ids.mapIndexedNotNull { i, id -> byId[id]?.copy(position = i) })
    }

    // --- water ----------------------------------------------------------------------
    private suspend fun syncWater(date: String, cups: Int, goal: Int) = lock.withLock {
        val (add, remove) = GameRules.waterDiff(date, cups, goal, db.ledger().keysFor(date).toSet())
        if (remove.isNotEmpty()) db.ledger().deleteKeys(remove.toList())
        add.forEach { db.ledger().insert(LedgerEntity.of(it)) }
        // the "Drink water" goal is checked while the day's water goal is reached
        val reached = goal in 1..cups
        for (g in db.goals().active().filter { it.kind == "water" }) {
            if (reached) db.completions().insert(CompletionEntity(g.id, date)) else db.completions().delete(g.id, date)
        }
        if (!reached) db.ledger().deleteKeys(listOf("allgoals:$date"))
        if (add.isNotEmpty()) afterActivity(date)
    }

    /** After something was done: the "every goal" bonus, streak milestones, the best streak. */
    private suspend fun afterActivity(date: String) {
        val goals = db.goals().active()
        val done = db.completions().forDate(date).map { it.goalId }.toSet()
        if (goals.isNotEmpty() && goals.all { it.id in done }) db.ledger().insert(LedgerEntity.of(GameRules.allGoalsReward(date)))
        if (date != today()) return
        val days = db.ledger().keysFor(date) // make sure today counts before the streak is read
        if (days.isEmpty()) return
        val best = db.meta().get(BEST)?.toIntOrNull() ?: 0
        val activeDays = mutableSetOf<String>()
        for (i in 0 until 400) {
            val d = dayKey(addDays(System.currentTimeMillis(), -i))
            if (db.ledger().keysFor(d).any { !it.startsWith("shop:") && !it.startsWith("allgoals:") && !it.startsWith("streak:") }) activeDays += d else if (i > 0) break
        }
        val s = GameRules.careStreak(activeDays, date, best)
        if (s.best > best) db.meta().put(MetaEntity(BEST, s.best.toString()))
        GameRules.milestoneReward(s.current, date)?.let { db.ledger().insert(LedgerEntity.of(it)) }
    }

    // --- shop (step 6) --------------------------------------------------------------
    suspend fun buy(itemId: String, price: Int, label: String): Boolean = lock.withLock { db.shop().buy(itemId, price, today(), "Bought $label") }

    suspend fun adoptedOn(): String = db.meta().get(ADOPTED) ?: today()

    companion object {
        private const val SEEDED = "starterPlanSeeded"
        private const val ADOPTED = "adoptedOn"
        private const val BEST = "bestCareStreak"

        @Volatile private var instance: GameRepo? = null
        fun get(ctx: Context): GameRepo = instance ?: synchronized(this) { instance ?: GameRepo(ctx.applicationContext).also { instance = it } }
    }
}
