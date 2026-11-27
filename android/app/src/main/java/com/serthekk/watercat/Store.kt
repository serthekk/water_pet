package com.serthekk.watercat

import android.content.Context
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import org.json.JSONObject
import java.util.UUID

/** The app's state, kept in SharedPreferences. Every change goes through [update]. */
class Store private constructor(ctx: Context) {
    private val prefs = ctx.getSharedPreferences("watercat", Context.MODE_PRIVATE)
    private val flow = MutableStateFlow(load())
    val state: StateFlow<State> get() = flow
    val now: State get() = flow.value

    private fun load(): State {
        val raw = prefs.getString("state", null)
        var s = try { if (raw != null) State.fromJson(JSONObject(raw)) else State() } catch (_: Exception) { State() }
        if (s.deviceId.isEmpty()) s = s.copy(deviceId = "android-" + UUID.randomUUID().toString())
        return s
    }

    @Synchronized
    fun update(f: (State) -> State): State {
        val next = f(flow.value)
        if (next != flow.value) {
            flow.value = next
            prefs.edit().putString("state", next.toJson().toString()).apply()
        }
        return next
    }

    /** A synced setting changed on the phone: it gets a fresh time stamp so it wins the next sync. */
    fun edit(vararg fields: String, f: (State) -> State): State = update { s ->
        val n = f(s)
        val t = System.currentTimeMillis()
        n.copy(stamps = n.stamps + fields.filter { it in SYNC_FIELDS }.associateWith { t })
    }

    companion object {
        @Volatile private var instance: Store? = null
        fun get(ctx: Context): Store = instance ?: synchronized(this) { instance ?: Store(ctx.applicationContext).also { instance = it } }
    }
}

/** Actions shared by the UI, the notification buttons and the sync worker. */
object Actions {
    fun addCup(ctx: Context, n: Int = 1) {
        val now = System.currentTimeMillis()
        val today = dayKey(now)
        Store.get(ctx).update { s ->
            s.copy(
                mine = s.mine + (today to (s.mine[today] ?: 0) + n),
                goals = s.goals + (today to s.goalCups),
                nagging = false,
                nextReminderAt = now + s.reminderMinutes * 60_000L,
            )
        }
        Notifications.cancelReminder(ctx)
        Scheduler.scheduleReminder(ctx)
        SyncWorker.syncSoon(ctx)
    }

    /** Takes back a cup logged on this phone today (cups from the computer are undone there). */
    fun undoCup(ctx: Context): Boolean {
        val today = dayKey(System.currentTimeMillis())
        var done = false
        Store.get(ctx).update { s ->
            val m = s.mine[today] ?: 0
            if (m <= 0) s else { done = true; s.copy(mine = s.mine + (today to m - 1)) }
        }
        if (done) SyncWorker.syncSoon(ctx)
        return done
    }

    fun pauseReminders(ctx: Context, until: Long) {
        Store.get(ctx).edit("remindersPausedUntil") { it.copy(remindersPausedUntil = until, nagging = false) }
        Notifications.cancelReminder(ctx)
        Scheduler.scheduleReminder(ctx)
        SyncWorker.syncSoon(ctx)
    }

    /** After any change of reminder settings / alarms (here or from a sync). */
    fun settingsChanged(ctx: Context, resetReminder: Boolean) {
        if (resetReminder) {
            val now = System.currentTimeMillis()
            Store.get(ctx).update { if (it.nagging) it else it.copy(nextReminderAt = now + it.reminderMinutes * 60_000L) }
        }
        Scheduler.rescheduleAll(ctx)
        SyncWorker.syncSoon(ctx)
    }
}
