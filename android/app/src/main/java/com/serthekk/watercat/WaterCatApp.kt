package com.serthekk.watercat

import android.app.Application

class WaterCatApp : Application() {
    override fun onCreate() {
        super.onCreate()
        Notifications.createChannels(this)
        SoundManager.get(this) // preloads every sound now, so the first tap is not silent
        GameRepo.get(this) // starter plan on first run; keeps the water rewards in step with the cups
        Scheduler.rescheduleAll(this)
        if (Store.get(this).now.paired) SyncWorker.schedulePeriodic(this)
        SyncNudges.watchWifi(this) // home Wi-Fi again -> sync a few seconds later
    }
}
