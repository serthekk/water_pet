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
) {
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
        combine(repo.goals, repo.completions(d), repo.ledger, repo.streak(d)) { goals, done, ledger, streak ->
            HomeUi(d, goals.map { GoalRow(it, it.id in done) }, GameRules.wallet(ledger, d), streak)
        }
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), HomeUi())

    /** Checks / unchecks a goal; [onReward] runs (on the main thread) when it was just checked. */
    fun toggle(goal: GoalEntity, onReward: (Reward) -> Unit = {}) {
        viewModelScope.launch { repo.toggle(goal)?.let(onReward) }
    }

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
