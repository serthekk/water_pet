package com.serthekk.watercat

import android.app.Application

class WaterCatApp : Application() {
    override fun onCreate() {
        super.onCreate()
        Notifications.createChannels(this)
        SoundManager.get(this) // preloads every sound now, so the first tap is not silent
        Scheduler.rescheduleAll(this)
        if (Store.get(this).now.paired) SyncWorker.schedulePeriodic(this)
    }
}
