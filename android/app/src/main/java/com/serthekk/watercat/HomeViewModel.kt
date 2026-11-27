package com.serthekk.watercat

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

/** One goal as the home screen shows it. */
data class GoalRow(val goal: GoalEntity, val done: Boolean)

data class HomeUi(
    val today: String = "",
    val goals: List<GoalRow> = emptyList(),
    val wallet: GameRules.Wallet = GameRules.Wallet(0, 0, 0),
    val streak: GameRules.Streak = GameRules.Streak(0, 0, false, false, 0),
    val adoptedOn: String = "",
    val trip: Adventures.Trip? = null, // the latest trip (today's, or one she never was welcomed back from)
    val journal: List<Adventures.Trip> = emptyList(), // welcomed trips, newest first
) {
    fun adventure(now: Long): Adventures.Status =
        Adventures.status(wallet.sipsToday, today, trip?.takeIf { it.date == today || !it.claimed }, now)
    val goalsLeft get() = goals.count { !it.done }
    /** Today's sips toward her next exploring trip (step 5). */
    val adventureProgress get() = (wallet.sipsToday.toFloat() / GameRules.ADVENTURE_SIPS).coerceIn(0f, 1f)
}

/** The home screen's state (goals, wallet, care streak) and actions. Survives rotation. */
@OptIn(ExperimentalCoroutinesApi::class)
class HomeViewModel(app: Application) : AndroidViewModel(app) {
    private val repo = GameRepo.get(app)

    // the date, re-read every minute so midnight starts a new day without a restart
    private val today = flow { while (true) { emit(dayKey(System.currentTimeMillis())); delay(60_000) } }.distinctUntilChanged()

    val ui: StateFlow<HomeUi> = today.flatMapLatest { d ->
        combine(
            combine(repo.goals, repo.completions(d), repo.ledger, repo.streak(d), repo.adoptedOn) { goals, done, ledger, streak, adopted ->
                HomeUi(d, goals.map { GoalRow(it, it.id in done) }, GameRules.wallet(ledger, d), streak, adopted ?: d)
            },
            repo.latestTrip, repo.journal,
        ) { ui, trip, journal -> ui.copy(trip = trip, journal = journal) }
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), HomeUi())

    /** Checks / unchecks a goal; [onReward] runs (on the main thread) when it was just checked. */
    fun toggle(goal: GoalEntity, onReward: (Reward) -> Unit = {}) {
        viewModelScope.launch { repo.toggle(goal)?.let(onReward) }
    }

    fun startAdventure(onStarted: (Adventures.Trip) -> Unit = {}) { viewModelScope.launch { repo.startAdventure()?.let(onStarted) } }
    fun claimAdventure(trip: Adventures.Trip, onClaimed: () -> Unit = {}) { viewModelScope.launch { if (repo.claimAdventure(trip)) onClaimed() } }

    fun addGoal(title: String, icon: String, sips: Int) { viewModelScope.launch { repo.addGoal(title, icon, sips) } }
    fun editGoal(goal: GoalEntity, title: String, icon: String, sips: Int) { viewModelScope.launch { repo.editGoal(goal, title, icon, sips) } }
    fun removeGoal(goal: GoalEntity) { viewModelScope.launch { repo.removeGoal(goal) } }
    fun move(goal: GoalEntity, by: Int) {
        val ids = ui.value.goals.map { it.goal.id }.toMutableList()
        val i = ids.indexOf(goal.id)
        val j = (i + by).coerceIn(0, ids.lastIndex)
        if (i < 0 || i == j) return
        ids.add(j, ids.removeAt(i))
        viewModelScope.launch { repo.reorder(ids) }
    }
}
