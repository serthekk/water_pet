package com.serthekk.watercat

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import java.util.Calendar

/**
 * AlarmManager scheduling. Water reminders: one pending alarm at State.nextReminderAt,
 * moved out of quiet hours / a pause. Daily alarms: one setAlarmClock() per enabled alarm
 * (they ring through Doze and show in the status bar like any alarm clock).
 */
object Scheduler {
    const val ACTION_REMINDER = "com.serthekk.watercat.REMINDER"
    const val ACTION_ALARM = "com.serthekk.watercat.ALARM"
    const val ACTION_LOG_CUP = "com.serthekk.watercat.LOG_CUP"
    const val ACTION_REMINDER_DISMISSED = "com.serthekk.watercat.REMINDER_DISMISSED"
    const val ACTION_ALARM_DISMISS = "com.serthekk.watercat.ALARM_DISMISS"
    const val ACTION_ALARM_SNOOZE = "com.serthekk.watercat.ALARM_SNOOZE"
    const val EXTRA_ID = "id"
    const val SNOOZE_MINUTES = 10

    private fun am(ctx: Context) = ctx.getSystemService(AlarmManager::class.java)

    fun broadcast(ctx: Context, action: String, data: String, id: String? = null): PendingIntent {
        val i = Intent(ctx, AlarmReceiver::class.java).setAction(action).setData(Uri.parse("watercat://$data"))
        if (id != null) i.putExtra(EXTRA_ID, id)
        return PendingIntent.getBroadcast(ctx, 0, i, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    }

    private fun canExact(ctx: Context) = Build.VERSION.SDK_INT < Build.VERSION_CODES.S || am(ctx).canScheduleExactAlarms()

    fun rescheduleAll(ctx: Context) {
        scheduleReminder(ctx)
        scheduleAlarms(ctx)
    }

    /** When the next water reminder may show, given quiet hours and a pause. */
    fun adjustReminderTime(s: State, t0: Long): Long {
        var t = t0
        repeat(3) {
            if (s.remindersPausedUntil > t) t = s.remindersPausedUntil
            val c = Calendar.getInstance().apply { timeInMillis = t }
            val minute = c.get(Calendar.HOUR_OF_DAY) * 60 + c.get(Calendar.MINUTE)
            if (isQuietAt(minute, s.quietStart, s.quietEnd)) {
                val end = toMinutes(s.quietEnd)
                c.set(Calendar.HOUR_OF_DAY, end / 60); c.set(Calendar.MINUTE, end % 60); c.set(Calendar.SECOND, 0); c.set(Calendar.MILLISECOND, 0)
                if (c.timeInMillis <= t) c.add(Calendar.DAY_OF_MONTH, 1)
                t = c.timeInMillis
            }
        }
        return t
    }

    fun scheduleReminder(ctx: Context) {
        val store = Store.get(ctx)
        val pi = broadcast(ctx, ACTION_REMINDER, "reminder")
        val s0 = store.now
        if (!s0.remindOnPhone) {
            am(ctx).cancel(pi)
            return
        }
        val now = System.currentTimeMillis()
        val s = store.update { st ->
            var next = st.nextReminderAt
            if (next <= 0 || next > now + 2 * 86_400_000L) next = now + st.reminderMinutes * 60_000L
            st.copy(nextReminderAt = next)
        }
        val at = adjustReminderTime(s, maxOf(s.nextReminderAt, now + 5_000))
        if (canExact(ctx)) am(ctx).setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi)
        else am(ctx).setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi)
    }

    /** The reminder alarm went off. Show it (or wait for the end of quiet hours / the pause). */
    fun onReminder(ctx: Context) {
        val store = Store.get(ctx)
        val s = store.now
        val now = System.currentTimeMillis()
        if (!s.remindOnPhone) return
        if (adjustReminderTime(s, now) > now + 60_000) { // quiet hours or paused: try again when they end
            store.update { it.copy(nextReminderAt = now, nagging = false) }
            Notifications.cancelReminder(ctx)
            scheduleReminder(ctx)
            return
        }
        Notifications.showReminder(ctx, store.now, again = s.nagging)
        store.update { it.copy(nagging = true, nextReminderAt = now + it.repeatMinutes * 60_000L) }
        scheduleReminder(ctx)
    }

    /** "Not now" / swiped away: no repeats, the next reminder comes after the usual interval. */
    fun onReminderDismissed(ctx: Context) {
        val now = System.currentTimeMillis()
        Store.get(ctx).update { it.copy(nagging = false, nextReminderAt = now + it.reminderMinutes * 60_000L) }
        scheduleReminder(ctx)
    }

    fun nextAlarmTime(a: Alarm, now: Long): Long {
        val c = Calendar.getInstance().apply {
            timeInMillis = now
            set(Calendar.HOUR_OF_DAY, a.hour); set(Calendar.MINUTE, a.minute); set(Calendar.SECOND, 0); set(Calendar.MILLISECOND, 0)
        }
        if (c.timeInMillis <= now) c.add(Calendar.DAY_OF_MONTH, 1)
        return c.timeInMillis
    }

    fun scheduleAlarms(ctx: Context) {
        val store = Store.get(ctx)
        val s = store.now
        val now = System.currentTimeMillis()
        val wanted = if (s.ringAlarms) s.alarms.filter { it.enabled } else emptyList()
        for (id in s.scheduledAlarmIds - wanted.map { it.id }.toSet()) am(ctx).cancel(broadcast(ctx, ACTION_ALARM, "alarm/$id", id))
        val show = PendingIntent.getActivity(ctx, 0, Intent(ctx, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE)
        for (a in wanted) {
            val pi = broadcast(ctx, ACTION_ALARM, "alarm/${a.id}", a.id)
            val at = nextAlarmTime(a, now)
            if (canExact(ctx)) am(ctx).setAlarmClock(AlarmManager.AlarmClockInfo(at, show), pi)
            else am(ctx).setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi)
        }
        store.update { it.copy(scheduledAlarmIds = wanted.map { a -> a.id }.toSet()) }
    }

    fun snoozeAlarm(ctx: Context, id: String) {
        val at = System.currentTimeMillis() + SNOOZE_MINUTES * 60_000L
        val pi = broadcast(ctx, ACTION_ALARM, "snooze/$id", id)
        val show = PendingIntent.getActivity(ctx, 0, Intent(ctx, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE)
        if (canExact(ctx)) am(ctx).setAlarmClock(AlarmManager.AlarmClockInfo(at, show), pi)
        else am(ctx).setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi)
    }

    /** A test alarm in [seconds] (Settings → Test alarm). */
    fun testAlarm(ctx: Context, seconds: Int) {
        val at = System.currentTimeMillis() + seconds * 1000L
        val pi = broadcast(ctx, ACTION_ALARM, "test", "test")
        if (canExact(ctx)) am(ctx).setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi)
        else am(ctx).setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi)
    }
}
