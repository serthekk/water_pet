package com.serthekk.watercat

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.ContentResolver
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.media.RingtoneManager
import android.net.Uri
import android.os.Build

object Notifications {
    const val CH_REMINDERS = "reminders_meow"
    const val CH_ALARMS = "alarms"
    const val CH_ADVENTURES = "adventures"
    private const val ID_ADVENTURE = 2
    private const val ID_REMINDER = 1

    /** Her reminder lines (the same ones the desktop cat rotates). */
    val LINES = listOf(
        "Its time to get wet girl 💦",
        "Sip sip hooray! 💧",
        "Hydration check, cutie 💦",
        "Your cat says: drink some water 🐾",
        "Psst... you look thirsty 👀",
        "Time for a little sip, my love 💙",
        "Stay hydrated, stay cute ✨",
        "Meow means drink! 💧",
        "Water break! Your plants would be proud 🌱",
        "Refill time, superstar 🥤",
        "A sip for you, a purr for me 😺",
    )

    private fun nm(ctx: Context) = ctx.getSystemService(NotificationManager::class.java)

    fun createChannels(ctx: Context) {
        // By name, not by resource id: a channel keeps its sound URI forever, and resource ids
        // can change between app versions (the sound would silently go missing after an update).
        val meow = Uri.parse("${ContentResolver.SCHEME_ANDROID_RESOURCE}://${ctx.packageName}/raw/meow_original")
        // 1.0/1.1 created "reminders" with an id-based sound URI to meow.wav (gone now): replace it
        nm(ctx).deleteNotificationChannel("reminders")
        val reminders = NotificationChannel(CH_REMINDERS, "Water reminders", NotificationManager.IMPORTANCE_HIGH).apply {
            description = "A meow and a nudge to drink, every so often (not in quiet hours)"
            setSound(meow, AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_NOTIFICATION).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build())
            enableVibration(true)
        }
        val alarms = NotificationChannel(CH_ALARMS, "Alarms", NotificationManager.IMPORTANCE_HIGH).apply {
            description = "Your daily alarms (medicine time etc.). They ring until you stop them."
            setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM) ?: RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION),
                AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build())
            enableVibration(true)
            vibrationPattern = longArrayOf(0, 600, 400, 600, 400, 600)
            setBypassDnd(true)
            lockscreenVisibility = Notification.VISIBILITY_PUBLIC
        }
        val adventures = NotificationChannel(CH_ADVENTURES, "Adventures", NotificationManager.IMPORTANCE_DEFAULT).apply {
            description = "When your cat is back from exploring"
        }
        nm(ctx).createNotificationChannels(listOf(reminders, alarms, adventures))
    }

    private fun openApp(ctx: Context) = PendingIntent.getActivity(ctx, 0,
        Intent(ctx, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP), PendingIntent.FLAG_IMMUTABLE)

    fun canNotify(ctx: Context) = nm(ctx).areNotificationsEnabled()

    fun showReminder(ctx: Context, s: State, again: Boolean) {
        if (!canNotify(ctx)) return
        val today = dayKey(System.currentTimeMillis())
        val line = if (Math.random() < 0.5) LINES[0] else LINES.random()
        val n = Notification.Builder(ctx, CH_REMINDERS)
            .setSmallIcon(R.drawable.ic_stat_cat)
            .setContentTitle(line)
            .setContentText("${s.total(today)} / ${s.goalCups} ${s.drinkWord} today")
            .setCategory(Notification.CATEGORY_REMINDER)
            .setContentIntent(openApp(ctx))
            .setDeleteIntent(Scheduler.broadcast(ctx, Scheduler.ACTION_REMINDER_DISMISSED, "reminder/dismissed"))
            .setOnlyAlertOnce(false)
            .setAutoCancel(true)
            .addAction(Notification.Action.Builder(null, "💧 I drank!", Scheduler.broadcast(ctx, Scheduler.ACTION_LOG_CUP, "cup")).build())
            .addAction(Notification.Action.Builder(null, "Not now", Scheduler.broadcast(ctx, Scheduler.ACTION_REMINDER_DISMISSED, "reminder/notnow")).build())
            .apply { if (again) setSubText("Still waiting for that sip…") }
            .build()
        nm(ctx).notify(ID_REMINDER, n)
    }

    fun cancelReminder(ctx: Context) = nm(ctx).cancel(ID_REMINDER)

    fun showAdventureBack(ctx: Context, name: String) {
        if (!canNotify(ctx)) return
        val n = Notification.Builder(ctx, CH_ADVENTURES)
            .setSmallIcon(R.drawable.ic_stat_cat)
            .setContentTitle("🎒 $name is back from exploring!")
            .setContentText("Come and see what $name found 🐾")
            .setContentIntent(openApp(ctx))
            .setAutoCancel(true)
            .build()
        nm(ctx).notify(ID_ADVENTURE, n)
    }

    fun cancelAdventure(ctx: Context) = nm(ctx).cancel(ID_ADVENTURE)

    private fun alarmNotifId(id: String) = 1000 + (id.hashCode() and 0xffff)

    fun showAlarm(ctx: Context, a: Alarm) {
        val full = PendingIntent.getActivity(ctx, 0,
            Intent(ctx, AlarmActivity::class.java).setData(Uri.parse("watercat://alarm/${a.id}"))
                .putExtra(AlarmActivity.EXTRA_ID, a.id).putExtra(AlarmActivity.EXTRA_TEXT, a.text)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_NO_USER_ACTION),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val n = Notification.Builder(ctx, CH_ALARMS)
            .setSmallIcon(R.drawable.ic_stat_cat)
            .setContentTitle("⏰ ${a.text}")
            .setContentText("Tap to open • rings until you stop it")
            .setCategory(Notification.CATEGORY_ALARM)
            .setVisibility(Notification.VISIBILITY_PUBLIC)
            .setFullScreenIntent(full, true)
            .setContentIntent(full)
            .setOngoing(true)
            .setTimeoutAfter(10 * 60_000L) // stops ringing after 10 minutes
            .addAction(Notification.Action.Builder(null, "Done ✓", Scheduler.broadcast(ctx, Scheduler.ACTION_ALARM_DISMISS, "dismiss/${a.id}", a.id)).build())
            .addAction(Notification.Action.Builder(null, "Snooze ${Scheduler.SNOOZE_MINUTES} min", Scheduler.broadcast(ctx, Scheduler.ACTION_ALARM_SNOOZE, "snooze-btn/${a.id}", a.id)).build())
            .build()
        n.flags = n.flags or Notification.FLAG_INSISTENT // the sound loops until the alarm is stopped
        nm(ctx).notify(alarmNotifId(a.id), n)
    }

    fun cancelAlarm(ctx: Context, id: String) = nm(ctx).cancel(alarmNotifId(id))

    fun canFullScreen(ctx: Context) = Build.VERSION.SDK_INT < 34 || nm(ctx).canUseFullScreenIntent()
}
