package com.serthekk.watercat

import android.app.KeyguardManager
import android.os.Build
import android.os.Bundle
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import java.text.DateFormat
import java.util.Date

/** Full-screen alarm (also over the lock screen): her message, Done and Snooze. */
class AlarmActivity : ComponentActivity() {
    companion object {
        const val EXTRA_ID = "id"
        const val EXTRA_TEXT = "text"
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (Build.VERSION.SDK_INT < 27) {
            @Suppress("DEPRECATION")
            window.addFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON)
        }
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        val id = intent.getStringExtra(EXTRA_ID) ?: "test"
        val text = intent.getStringExtra(EXTRA_TEXT) ?: "Alarm"
        setContent {
            WaterCatTheme {
                AlarmScreen(text,
                    onDone = { Notifications.cancelAlarm(this, id); finishUnlocked() },
                    onSnooze = {
                        Notifications.cancelAlarm(this, id)
                        if (id != "test") Scheduler.snoozeAlarm(this, id)
                        finishUnlocked()
                    })
            }
        }
    }

    private fun finishUnlocked() {
        // leave the lock screen as it was: just close
        val km = getSystemService(KeyguardManager::class.java)
        if (km != null && km.isKeyguardLocked) finishAndRemoveTask() else finish()
    }
}

@Composable
internal fun AlarmScreen(text: String, onDone: () -> Unit, onSnooze: () -> Unit) {
    Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
        Column(
            Modifier.fillMaxSize().padding(32.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center,
        ) {
            Text(DateFormat.getTimeInstance(DateFormat.SHORT).format(Date()), fontSize = 64.sp, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.primary)
            Spacer(Modifier.height(24.dp))
            val ctx = androidx.compose.ui.platform.LocalContext.current
            val cat = androidx.compose.runtime.remember { CatState() }
            val sprites = SpriteData.get(ctx)
            val me = Store.get(ctx).now.cat(sprites)
            androidx.compose.runtime.LaunchedEffect(Unit) { while (true) { cat.play("boop"); cat.hop(); kotlinx.coroutines.delay(2500) } } // she wants your attention
            PixelCat(cat, me.look(), Modifier.size(240.dp, 216.dp), accessories = me.worn(), catName = me.name)
            Spacer(Modifier.height(24.dp))
            Text(text, fontSize = 28.sp, fontWeight = FontWeight.SemiBold, textAlign = TextAlign.Center)
            Spacer(Modifier.height(48.dp))
            Button(onDone, Modifier.fillMaxWidth().height(64.dp)) { Text("Done ✓", fontSize = 22.sp) }
            Spacer(Modifier.height(12.dp))
            OutlinedButton(onSnooze, Modifier.fillMaxWidth().height(56.dp)) { Text("Snooze ${Scheduler.SNOOZE_MINUTES} min", fontSize = 18.sp) }
        }
    }
}
