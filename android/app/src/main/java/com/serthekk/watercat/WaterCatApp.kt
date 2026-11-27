package com.serthekk.watercat

import android.app.Application
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

class WaterCatApp : Application() {
    override fun onCreate() {
        super.onCreate()
        Notifications.createChannels(this)
        Scheduler.rescheduleAll(this)
        if (Store.get(this).now.paired) SyncWorker.schedulePeriodic(this)
    }
}

// The desktop app's "cream" theme.
private val Light = lightColorScheme(
    primary = Color(0xFFB4621C), onPrimary = Color.White,
    secondary = Color(0xFFF4A6B8), onSecondary = Color(0xFF3B2F2F),
    tertiary = Color(0xFFE8913A),
    background = Color(0xFFFFF6EA), onBackground = Color(0xFF3B2F2F),
    surface = Color(0xFFFFFFFF), onSurface = Color(0xFF3B2F2F),
    surfaceVariant = Color(0xFFFBE9D7), onSurfaceVariant = Color(0xFF6B5650),
    primaryContainer = Color(0xFFFFDDBF), onPrimaryContainer = Color(0xFF3B2F2F),
    secondaryContainer = Color(0xFFFDE0E7), onSecondaryContainer = Color(0xFF3B2F2F),
)
private val Dark = darkColorScheme(
    primary = Color(0xFFF2A65A), onPrimary = Color(0xFF3B2414),
    secondary = Color(0xFFF4A6B8), onSecondary = Color(0xFF3B2F2F),
    tertiary = Color(0xFFE8913A),
    background = Color(0xFF231C1A), onBackground = Color(0xFFF5E9DF),
    surface = Color(0xFF2F2624), onSurface = Color(0xFFF5E9DF),
    surfaceVariant = Color(0xFF3B302D), onSurfaceVariant = Color(0xFFD9C6BC),
    primaryContainer = Color(0xFF5A3A1E), onPrimaryContainer = Color(0xFFFFDDBF),
    secondaryContainer = Color(0xFF5B3540), onSecondaryContainer = Color(0xFFFDE0E7),
)

@Composable
fun WaterCatTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = if (isSystemInDarkTheme()) Dark else Light, content = content)
}
