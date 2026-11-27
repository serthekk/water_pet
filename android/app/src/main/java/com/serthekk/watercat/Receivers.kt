package com.serthekk.watercat

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

class AlarmReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        val id = intent.getStringExtra(Scheduler.EXTRA_ID)
        when (intent.action) {
            Scheduler.ACTION_REMINDER -> Scheduler.onReminder(ctx)
            Scheduler.ACTION_LOG_CUP -> Actions.addCup(ctx)
            Scheduler.ACTION_REMINDER_DISMISSED -> Scheduler.onReminderDismissed(ctx)
            Scheduler.ACTION_ALARM -> {
                if (id == "test") {
                    Notifications.showAlarm(ctx, Alarm("test", hhmm(0, 0), "Test alarm 🐾 It works!"))
                    return
                }
                val a = Store.get(ctx).now.alarms.firstOrNull { it.id == id }
                if (a != null && a.enabled && Store.get(ctx).now.ringAlarms) Notifications.showAlarm(ctx, a)
                Scheduler.scheduleAlarms(ctx) // tomorrow's
            }
            Scheduler.ACTION_ALARM_DISMISS -> if (id != null) Notifications.cancelAlarm(ctx, id)
            Scheduler.ACTION_ALARM_SNOOZE -> if (id != null) {
                Notifications.cancelAlarm(ctx, id)
                if (id != "test") Scheduler.snoozeAlarm(ctx, id)
            }
        }
    }
}

/** After a reboot, an app update or a clock change, AlarmManager needs everything again. */
class BootReceiver : BroadcastReceiver() {
    private val actions = setOf(Intent.ACTION_BOOT_COMPLETED, Intent.ACTION_MY_PACKAGE_REPLACED, Intent.ACTION_TIME_CHANGED,
        Intent.ACTION_TIMEZONE_CHANGED, "android.app.action.SCHEDULE_EXACT_ALARM_PERMISSION_STATE_CHANGED")

    override fun onReceive(ctx: Context, intent: Intent) {
        if (intent.action !in actions) return
        Scheduler.rescheduleAll(ctx)
        if (Store.get(ctx).now.paired) SyncWorker.schedulePeriodic(ctx)
    }
}
