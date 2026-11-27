package com.serthekk.watercat

import android.Manifest
import android.app.TimePickerDialog
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.PowerManager
import android.provider.Settings
import android.text.format.DateFormat
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Image
import androidx.compose.foundation.combinedClickable
import androidx.compose.material3.AssistChip
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.material3.FilterChip
import androidx.compose.ui.graphics.Color
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Slider
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalView
import kotlin.math.roundToInt
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.FilterQuality
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.res.imageResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.util.Calendar
import java.util.Date

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent { WaterCatTheme { App() } }
        // while the app is open: sync now and every minute (cups from the computer show up)
        lifecycleScope.launch {
            repeatOnLifecycle(Lifecycle.State.STARTED) {
                while (true) {
                    if (Store.get(this@MainActivity).now.paired) SyncClient.sync(this@MainActivity)
                    delay(60_000)
                }
            }
        }
    }
}

private enum class Tab(val icon: String, val label: String) { Today("💧", "Today"), Cat("🐱", "Cat"), Alarms("⏰", "Alarms"), Settings("⚙️", "Settings"), Sync("📶", "Sync") }

@Composable
internal fun App(startTab: Int = 0) {
    val ctx = LocalContext.current
    val s by Store.get(ctx).state.collectAsState()
    var tab by rememberSaveable { mutableStateOf(Tab.entries[startTab]) }
    // ticks every 30 s so times ("in 12 min") stay fresh
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(Unit) { while (true) { now = System.currentTimeMillis(); delay(30_000) } }

    Scaffold(
        bottomBar = {
            NavigationBar {
                Tab.entries.forEach { t ->
                    NavigationBarItem(selected = tab == t, onClick = { tab = t }, icon = { Text(t.icon, fontSize = 20.sp) }, label = { Text(t.label) })
                }
            }
        },
    ) { pad ->
        Box(Modifier.padding(pad).fillMaxSize()) {
            when (tab) {
                Tab.Today -> TodayScreen(s, now)
                Tab.Cat -> ProfileScreen(s, now)
                Tab.Alarms -> AlarmsScreen(s)
                Tab.Settings -> SettingsScreen(s)
                Tab.Sync -> SyncScreen(s, now)
            }
        }
    }
}

// --- shared bits ------------------------------------------------------------
@Composable
internal fun SectionCard(title: String? = null, content: @Composable () -> Unit) {
    Card(Modifier.fillMaxWidth(), shape = MaterialTheme.shapes.large, colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        elevation = CardDefaults.cardElevation(defaultElevation = 1.dp)) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            if (title != null) Text(title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
            content()
        }
    }
}

@Composable
internal fun Page(content: @Composable () -> Unit) {
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) { content() }
}

internal fun timeText(ctx: android.content.Context, ms: Long): String = DateFormat.getTimeFormat(ctx).format(Date(ms))

internal fun formatHHMM(ctx: android.content.Context, t: String): String {
    val c = Calendar.getInstance().apply { set(Calendar.HOUR_OF_DAY, toMinutes(t) / 60); set(Calendar.MINUTE, toMinutes(t) % 60) }
    return DateFormat.getTimeFormat(ctx).format(c.time)
}

internal fun pickTime(ctx: android.content.Context, initial: String, onPicked: (String) -> Unit) {
    TimePickerDialog(ctx, { _, h, m -> onPicked(hhmm(h, m)) }, toMinutes(initial) / 60, toMinutes(initial) % 60, DateFormat.is24HourFormat(ctx)).show()
}

// --- Today ------------------------------------------------------------------
@Composable
internal fun GoalDialog(goal: GoalEntity?, onDismiss: () -> Unit, onSave: (String, String, Int) -> Unit, onRemove: () -> Unit = {}, onMove: (Int) -> Unit = {}) {
    var title by remember { mutableStateOf(goal?.title ?: "") }
    var icon by remember { mutableStateOf(goal?.icon ?: "⭐") }
    var sips by remember { mutableIntStateOf(goal?.sips ?: GameRules.DEFAULT_GOAL_SIPS) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(if (goal == null) "New goal" else "Edit goal") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                OutlinedTextField(title, { title = it.take(60) }, label = { Text("Goal") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    listOf("⭐", "💧", "🪥", "🧘", "🌬️", "🛏️", "😊", "🚶", "🍎", "💊", "📚", "🧹", "🌞", "🎨", "🫖", "🎧").forEach { e ->
                        FilterChip(icon == e, { icon = e }, label = { Text(e, fontSize = 18.sp) })
                    }
                }
                if (goal?.kind != "water") Stepper("Sips", sips, "💧", 1..20) { sips = it }
                if (goal != null) Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedButton({ onMove(-1) }) { Text("Move up") }
                    OutlinedButton({ onMove(1) }) { Text("Move down") }
                }
            }
        },
        confirmButton = { TextButton({ onSave(title, icon, sips) }, enabled = title.isNotBlank()) { Text("Save") } },
        dismissButton = {
            Row {
                if (goal != null && goal.kind != "water") TextButton(onRemove) { Text("Remove") }
                TextButton(onDismiss) { Text("Cancel") }
            }
        },
    )
}

internal fun reminderLine(ctx: android.content.Context, s: State, now: Long): String {
    if (!s.remindOnPhone) return "Reminders are off on this phone (Settings)."
    if (s.remindersPaused(now)) return "⏸ Paused until ${timeText(ctx, s.remindersPausedUntil)}" + if (dayKey(s.remindersPausedUntil) != dayKey(now)) " tomorrow" else ""
    val c = Calendar.getInstance().apply { timeInMillis = now }
    if (isQuietAt(c.get(Calendar.HOUR_OF_DAY) * 60 + c.get(Calendar.MINUTE), s.quietStart, s.quietEnd)) return "🌙 Quiet hours until ${formatHHMM(ctx, s.quietEnd)}"
    if (s.nagging) return "${s.cat(SpriteData.get(ctx)).name} is waiting for you to drink 🥺"
    val at = Scheduler.adjustReminderTime(s, maxOf(s.nextReminderAt, now))
    val mins = ((at - now) / 60_000).coerceAtLeast(0)
    return "Next reminder at ${timeText(ctx, at)} (in ${if (mins >= 60) "${mins / 60} h ${mins % 60} min" else "$mins min"})"
}

internal fun syncLine(s: State, now: Long): String = when {
    s.offHome && s.syncError.isEmpty() -> "🏠 Away from your home Wi-Fi: everything is saved on this phone and syncs when you're home"
    s.syncError.isNotEmpty() -> "⚠ ${s.syncError}"
    s.lastSync == 0L -> "Not synced yet"
    now - s.lastSync < 90_000 -> "✓ Synced with ${s.desktopName} just now"
    else -> "Synced with ${s.desktopName} ${(now - s.lastSync) / 60_000} min ago"
}

@Composable
internal fun WeekChart(s: State, now: Long) {
    val today = dayKey(now)
    val days = (6 downTo 0).map { addDays(now, -it) }
    val max = maxOf(days.maxOf { s.total(dayKey(it)) }, s.goalCups, 1)
    val names = java.text.SimpleDateFormat("EEE", java.util.Locale.getDefault())
    Row(Modifier.fillMaxWidth().height(110.dp), horizontalArrangement = Arrangement.SpaceEvenly, verticalAlignment = Alignment.Bottom) {
        days.forEach { t ->
            val k = dayKey(t)
            val v = s.total(k)
            val met = v >= s.goalOn(k, today)
            Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.weight(1f)) {
                Text("$v", fontSize = 11.sp)
                Box(Modifier.width(18.dp).height((70f * v / max).dp.coerceAtLeast(3.dp)).clip(RoundedCornerShape(4.dp))
                    .background(if (met) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.secondary))
                Text(if (k == today) "Today" else names.format(Date(t)), fontSize = 11.sp, fontWeight = if (k == today) FontWeight.Bold else FontWeight.Normal)
            }
        }
    }
}

@Composable
internal fun PermissionBanner() {
    val ctx = LocalContext.current
    var refresh by remember { mutableIntStateOf(0) }
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { refresh++ }
    val needNotif = Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(ctx, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
    LaunchedEffect(Unit) { if (needNotif) launcher.launch(Manifest.permission.POST_NOTIFICATIONS) }
    if (needNotif && refresh >= 0) {
        Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.secondaryContainer)) {
            Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("${Store.get(ctx).now.catName} needs notifications to remind you and ring your alarms.")
                Button({ launcher.launch(Manifest.permission.POST_NOTIFICATIONS) }) { Text("Allow notifications") }
            }
        }
    } else if (!Notifications.canFullScreen(ctx)) {
        Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.secondaryContainer)) {
            Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("Allow full-screen alarms so they show over the lock screen.")
                Button({
                    if (Build.VERSION.SDK_INT >= 34) ctx.startActivity(Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT, Uri.parse("package:${ctx.packageName}")))
                }) { Text("Open settings") }
            }
        }
    }
}

// --- Alarms -----------------------------------------------------------------
@Composable
private fun AlarmsScreen(s: State) {
    val ctx = LocalContext.current
    var editing by remember { mutableStateOf<Alarm?>(null) }
    var isNew by remember { mutableStateOf(false) }
    Box(Modifier.fillMaxSize()) {
        LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp, 16.dp, 16.dp, 96.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            item {
                Text("Daily alarms", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
                Text(
                    if (s.paired) "They ring here and on ${s.desktopName.ifEmpty { "your computer" }} (synced)." else "They ring every day at that time until you stop them. Quiet hours don't apply.",
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                if (!s.ringAlarms) Text("⚠ Alarms are turned off on this phone (Settings).", color = MaterialTheme.colorScheme.primary)
            }
            if (s.alarms.isEmpty()) item {
                SectionCard { Text("No alarms yet. Add one for medicine, a stretch, or anything else ${s.cat(SpriteData.get(ctx)).name} should remind you of.") }
            }
            items(s.alarms, key = { it.id }) { a ->
                Card(Modifier.fillMaxWidth().clickable { editing = a; isNew = false }, shape = MaterialTheme.shapes.large,
                    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)) {
                    Row(Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text(formatHHMM(ctx, a.time), fontSize = 32.sp, fontWeight = FontWeight.Bold,
                                color = if (a.enabled) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.onSurfaceVariant)
                            Text(a.text, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                        Switch(a.enabled, { on ->
                            Store.get(ctx).edit("alarms") { st -> st.copy(alarms = st.alarms.map { if (it.id == a.id) it.copy(enabled = on) else it }) }
                            Actions.settingsChanged(ctx, false)
                        })
                    }
                }
            }
        }
        if (s.alarms.size < Alarm.MAX_ALARMS) {
            ExtendedFloatingActionButton({ editing = Alarm(Alarm.newId(), "08:00", "", true); isNew = true },
                Modifier.align(Alignment.BottomEnd).padding(16.dp)) { Text("＋ Add alarm") }
        }
    }
    editing?.let { a ->
        AlarmDialog(a, isNew, onDismiss = { editing = null }, onSave = { saved ->
            Store.get(ctx).edit("alarms") { st -> st.copy(alarms = if (isNew) st.alarms + saved else st.alarms.map { if (it.id == saved.id) saved else it }) }
            Actions.settingsChanged(ctx, false)
            editing = null
        }, onDelete = {
            Store.get(ctx).edit("alarms") { st -> st.copy(alarms = st.alarms.filter { it.id != a.id }) }
            Actions.settingsChanged(ctx, false)
            editing = null
        })
    }
}

@Composable
private fun AlarmDialog(a: Alarm, isNew: Boolean, onDismiss: () -> Unit, onSave: (Alarm) -> Unit, onDelete: () -> Unit) {
    val ctx = LocalContext.current
    var time by remember { mutableStateOf(a.time) }
    var text by remember { mutableStateOf(a.text) }
    val clean = text.replace(Regex("\\s+"), " ").trim()
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(if (isNew) "New alarm" else "Edit alarm") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                OutlinedButton({ pickTime(ctx, time) { time = it } }, Modifier.fillMaxWidth()) { Text(formatHHMM(ctx, time), fontSize = 28.sp) }
                OutlinedTextField(text, { if (it.length <= 120) text = it }, label = { Text("Message") }, placeholder = { Text("Medicine time 💊") }, singleLine = false, modifier = Modifier.fillMaxWidth())
            }
        },
        confirmButton = { TextButton({ onSave(a.copy(time = time, text = clean)) }, enabled = clean.isNotEmpty()) { Text("Save") } },
        dismissButton = {
            Row {
                if (!isNew) TextButton(onDelete) { Text("Delete") }
                TextButton(onDismiss) { Text("Cancel") }
            }
        },
    )
}

// --- Settings ---------------------------------------------------------------
@Composable
internal fun Stepper(label: String, value: Int, unit: String, range: IntRange, step: Int = 1, onChange: (Int) -> Unit) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Text(label, Modifier.weight(1f), fontWeight = FontWeight.SemiBold)
        OutlinedButton({ onChange((value - step).coerceIn(range)) }, enabled = value > range.first, contentPadding = PaddingValues(0.dp), modifier = Modifier.size(40.dp)) { Text("−") }
        Text("$value $unit", Modifier.width(92.dp), textAlign = TextAlign.Center)
        OutlinedButton({ onChange((value + step).coerceIn(range)) }, enabled = value < range.last, contentPadding = PaddingValues(0.dp), modifier = Modifier.size(40.dp)) { Text("+") }
    }
}

@Composable
internal fun ToggleRow(label: String, hint: String?, value: Boolean, onChange: (Boolean) -> Unit) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            Text(label, fontWeight = FontWeight.SemiBold)
            if (hint != null) Text(hint, fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        Switch(value, onChange)
    }
}

@Composable
private fun SettingsScreen(s: State) {
    val ctx = LocalContext.current
    val store = Store.get(ctx)
    Page {
        Text("Settings", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
        if (s.paired) Text("Goal, reminders, quiet hours and alarms sync with ${s.desktopName}.", color = MaterialTheme.colorScheme.onSurfaceVariant)
        LookCard(s)
        SectionCard("💧 Water") {
            Stepper("Daily goal", s.goalCups, s.drinkWord, 1..100) { v -> store.edit("goalCups") { it.copy(goalCups = v) }; Actions.settingsChanged(ctx, false) }
            Stepper("Remind every", s.reminderMinutes, "min", 5..1440, 5) { v -> store.edit("reminderMinutes") { it.copy(reminderMinutes = v) }; Actions.settingsChanged(ctx, true) }
            Stepper("Repeat every", s.repeatMinutes, "min", 1..120) { v -> store.edit("repeatMinutes") { it.copy(repeatMinutes = v) }; Actions.settingsChanged(ctx, false) }
            Text("Until you drink, a reminder comes back this often. \"Not now\" stops the repeats.", fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("Quiet hours", Modifier.weight(1f), fontWeight = FontWeight.SemiBold)
                OutlinedButton({ pickTime(ctx, s.quietStart) { v -> store.edit("quietStart") { it.copy(quietStart = v) }; Actions.settingsChanged(ctx, false) } }) { Text(formatHHMM(ctx, s.quietStart)) }
                Text("  to  ")
                OutlinedButton({ pickTime(ctx, s.quietEnd) { v -> store.edit("quietEnd") { it.copy(quietEnd = v) }; Actions.settingsChanged(ctx, false) } }) { Text(formatHHMM(ctx, s.quietEnd)) }
            }
            Text("No water reminders in this window (alarms still ring). Same time twice = no quiet hours.", fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        SoundCard()
        SectionCard("📱 This phone") {
            ToggleRow("Water reminders on this phone", "Turn off if you only want the cat on your computer to remind you.", s.remindOnPhone) { v ->
                store.update { it.copy(remindOnPhone = v, nagging = false) }
                if (!v) Notifications.cancelReminder(ctx)
                Actions.settingsChanged(ctx, true)
            }
            ToggleRow("Ring alarms on this phone", null, s.ringAlarms) { v -> store.update { it.copy(ringAlarms = v) }; Actions.settingsChanged(ctx, false) }
            HorizontalDivider()
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedButton({ Notifications.showReminder(ctx, store.now, again = false) }) { Text("Test reminder") }
                OutlinedButton({
                    Scheduler.testAlarm(ctx, 5)
                    Toast.makeText(ctx, "The test alarm rings in 5 seconds. Lock the phone to see it full-screen.", Toast.LENGTH_LONG).show()
                }) { Text("Test alarm") }
            }
        }
        SectionCard("🔋 Reliability") {
            val pm = ctx.getSystemService(PowerManager::class.java)
            val optimized = pm != null && !pm.isIgnoringBatteryOptimizations(ctx.packageName)
            Text(
                if (optimized) "Some phones delay reminders to save battery. If reminders come late, let WaterCat run unrestricted."
                else "✓ Battery optimisation is off for WaterCat: reminders come on time.",
                fontSize = 14.sp,
            )
            if (optimized) OutlinedButton({
                runCatching { ctx.startActivity(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)) }
            }) { Text("Battery settings") }
            OutlinedButton({
                ctx.startActivity(Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, ctx.packageName))
            }) { Text("Notification sounds") }
        }
        Text("WaterCat for Android ${runCatching { ctx.packageManager.getPackageInfo(ctx.packageName, 0).versionName }.getOrNull() ?: ""}",
            Modifier.fillMaxWidth(), textAlign = TextAlign.Center, fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
private fun LocationPermissionButton(onResult: () -> Unit) {
    val ctx = LocalContext.current
    var asked by remember { mutableIntStateOf(0) }
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { asked++; onResult() }
    if (asked >= 0) Button({
        if (asked >= 2) ctx.startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:${ctx.packageName}")))
        else launcher.launch(arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION))
    }) { Text(if (asked >= 2) "Open app settings" else "Allow (to read the Wi-Fi name)") }
}

@Composable
private fun LookCard(s: State) {
    val ctx = LocalContext.current
    val sprites = SpriteData.get(ctx)
    val ui = UiPrefs.get(ctx)
    val themeId by ui.theme.collectAsState()
    SectionCard("🎨 Look") {
        Text("Colours", fontWeight = FontWeight.SemiBold)
        Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            DesktopTheme.all(ctx).forEach { t ->
                val sel = t.id == themeId
                Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.width(76.dp).clip(MaterialTheme.shapes.medium)
                    .background(if (sel) MaterialTheme.colorScheme.primaryContainer else Color.Transparent).clickable { ui.setTheme(t.id) }.padding(6.dp)) {
                    Row(Modifier.clip(RoundedCornerShape(10.dp))) {
                        listOf("bg", "accent", "hover", "check").forEach { k -> Box(Modifier.size(15.dp, 30.dp).background(t.vars.getValue(k))) }
                    }
                    Text(t.label, fontSize = 11.sp, textAlign = TextAlign.Center, maxLines = 2, lineHeight = 13.sp)
                }
            }
        }
    }
    CatEditor(s)
}

/** Her name, pronouns, description, coat, items and sleeping spot. Syncs with the desktop's active cat. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun CatEditor(s: State) {
    val ctx = LocalContext.current
    val sprites = SpriteData.get(ctx)
    val me = s.cat(sprites)
    var name by remember(me.id) { mutableStateOf(me.name) }
    var desc by remember(me.id) { mutableStateOf(me.description) }
    LaunchedEffect(me.name) { if (me.name != name.trim()) name = me.name } // changed by a sync
    SectionCard("🐱 ${me.name}") {
        Text(if (s.paired) "This is ${me.name} on ${s.desktopName}: changes here show on the computer after the next sync, and the other way round." else "Pair with your computer (Sync tab) to have the same cat on both.",
            fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
        OutlinedTextField(name, { v -> name = v.take(40); if (v.isNotBlank()) editCat(ctx) { it.withName(v) } }, label = { Text("Name") }, singleLine = true, modifier = Modifier.fillMaxWidth())
        Text("Pronouns", fontWeight = FontWeight.SemiBold)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            listOf("female" to "She/Her", "male" to "He/Him", "unspecified" to "They/Them").forEach { (g, label) ->
                FilterChip(me.gender == g, { editCat(ctx) { it.withGender(g) } }, label = { Text(label) })
            }
        }
        OutlinedTextField(desc, { v -> desc = v.take(200); editCat(ctx) { it.withDescription(desc) } }, label = { Text("About ${me.name}") }, modifier = Modifier.fillMaxWidth(), minLines = 2)
        Text("Coat", fontWeight = FontWeight.SemiBold)
        Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            sprites.presets.values.filter { !it.unlock || it.id == me.preset }.forEach { p ->
                val sel = p.id == me.preset
                Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.width(76.dp).clip(MaterialTheme.shapes.medium)
                    .background(if (sel) MaterialTheme.colorScheme.primaryContainer else Color.Transparent)
                    .clickable { editCat(ctx) { it.withPreset(p) } }.padding(4.dp)) {
                    CatThumb(p.look, Modifier.size(64.dp, 58.dp))
                    Text(p.label, fontSize = 11.sp, textAlign = TextAlign.Center, maxLines = 2, lineHeight = 13.sp)
                }
            }
        }
        if (me.preset == "custom") Text("Her own colours from the computer (pick a coat to replace them).", fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text("Wearing", fontWeight = FontWeight.SemiBold)
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            sprites.accessories.values.filter { !it.unlock || me.isWearing(it.id) }.forEach { item ->
                val on = me.isWearing(item.id)
                FilterChip(on, { editCat(ctx) { it.wearing(item.id, !on) } }, label = { Text(item.label) })
            }
        }
        Text("Sleeps in", fontWeight = FontWeight.SemiBold)
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            listOf("random" to "Random", "bed" to "Cat bed", "tree" to "Cat tree", "box" to "Box", "none" to "The floor").forEach { (id, label) ->
                FilterChip(me.sleepSpot == id, { editCat(ctx) { it.withSleepSpot(id) } }, label = { Text(label) })
            }
        }
        ToggleRow("Tail", null, me.tail) { v -> editCat(ctx) { it.withTail(v) } }
        ToggleRow("Whiskers", null, me.whiskers) { v -> editCat(ctx) { it.withWhiskers(v) } }
    }
}

/** A still picture of a look (sitting, from the sprite renderer), cropped to her and what she wears. */
@Composable
fun CatThumb(look: Look, modifier: Modifier = Modifier, accessories: Map<String, Worn> = emptyMap(), seasonal: String? = null) {
    val data = SpriteData.get(LocalContext.current)
    val scene = remember(look, accessories, seasonal) { data.renderScene(SceneOptions(look = look, accessories = accessories, seasonal = seasonal)) }
    Canvas(modifier) {
        var minX = data.cols; var minY = data.rows; var maxX = -1; var maxY = -1
        for (y in 0 until data.rows) for (x in 0 until data.cols) if (scene.under[y][x] != null) {
            minX = kotlin.math.min(minX, x); maxX = kotlin.math.max(maxX, x); minY = kotlin.math.min(minY, y); maxY = kotlin.math.max(maxY, y)
        }
        if (maxX < 0) return@Canvas
        val bw = maxX - minX + 1
        val bh = maxY - minY + 1
        val cell = kotlin.math.floor(kotlin.math.min(size.width / bw, size.height / bh)).coerceAtLeast(1f)
        val ox = (size.width - bw * cell) / 2 - minX * cell
        val oy = (size.height - bh * cell) / 2 - minY * cell
        for (y in 0 until data.rows) for (x in 0 until data.cols) scene.under[y][x]?.let {
            drawRect(Color(it), androidx.compose.ui.geometry.Offset(ox + x * cell, oy + y * cell), androidx.compose.ui.geometry.Size(cell, cell))
        }
    }
}

@Composable
private fun SoundCard() {
    val ctx = LocalContext.current
    val sound = SoundManager.get(ctx)
    val ss by sound.settings.collectAsState()
    var picking by remember { mutableStateOf(false) }
    var vol by remember(ss.volume) { mutableFloatStateOf(ss.volume) }
    SectionCard("🔊 Sound") {
        ToggleRow("Sound on", "Off = no meows, purrs or chirps in the app (reminders and alarms use the phone's notification sound settings).", ss.soundOn) { sound.setSoundOn(it) }
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("Volume", Modifier.width(72.dp), fontWeight = FontWeight.SemiBold)
            Slider(vol, { vol = it }, Modifier.weight(1f), enabled = ss.soundOn, steps = 19,
                onValueChangeFinished = { sound.setVolume(vol); sound.meow() }) // let her hear the new volume
            Text("${(vol * 100).roundToInt()}%", Modifier.width(48.dp), textAlign = TextAlign.End)
        }
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("Meow", Modifier.weight(1f), fontWeight = FontWeight.SemiBold)
            OutlinedButton({ picking = true }, enabled = ss.soundOn) {
                Text(Meow.entries.firstOrNull { it.id == ss.meowStyle }?.label ?: "Random (mix it up)", maxLines = 1)
            }
        }
        ToggleRow("Happy chirp when I log a drink", "Off: she meows instead.", ss.cupChirp) { sound.setCupChirp(it) }
        ToggleRow("Vibrate a little on rewards", null, ss.haptics) { sound.setHaptics(it) }
    }
    if (picking) AlertDialog(
        onDismissRequest = { picking = false },
        title = { Text("Her meow") },
        text = {
            Column {
                (listOf("random" to "Random (mix it up)") + Meow.entries.map { it.id to it.label }).forEach { (id, label) ->
                    Row(Modifier.fillMaxWidth().clickable { sound.setMeowStyle(id); sound.meow(id) }.padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                        RadioButton(ss.meowStyle == id, { sound.setMeowStyle(id); sound.meow(id) })
                        Text(label)
                    }
                }
            }
        },
        confirmButton = { TextButton({ picking = false }) { Text("Done") } },
    )
}

// --- Sync -------------------------------------------------------------------
@Composable
private fun SyncScreen(s: State, now: Long) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    var busy by remember { mutableStateOf(false) }
    var message by remember { mutableStateOf("") }
    var found by remember { mutableStateOf<List<SyncClient.Computer>?>(null) }
    var address by rememberSaveable { mutableStateOf(if (s.host.isNotEmpty()) "${s.host}:${s.port}" else "") }
    var code by rememberSaveable { mutableStateOf("") }
    var confirmUnpair by remember { mutableStateOf(false) }
    var permTick by remember { mutableIntStateOf(0) } // re-reads the Wi-Fi name after a permission answer

    Page {
        Text("Sync with your computer", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
        if (s.paired) {
            SectionCard("🖥 ${s.desktopName}") {
                Text(syncLine(s, now))
                Text("🏠 Home Wi-Fi: ${s.homeSsid}", fontWeight = FontWeight.SemiBold)
                Text("Cups, goal, reminders, quiet hours and alarms sync only on this Wi-Fi: right away when the app is open, and every 15 minutes or so in the background. " +
                    "On any other network nothing is sent; changes wait on the phone. To change the home Wi-Fi, unpair and pair again there.",
                    fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                if (s.syncError.isNotEmpty() && !HomeWifi.hasPermission(ctx)) LocationPermissionButton { permTick++ }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                    Button({
                        busy = true
                        scope.launch {
                            val r = SyncClient.sync(ctx)
                            message = if (r.isSuccess) "Synced ✓" else r.exceptionOrNull()?.message ?: "Sync failed"
                            busy = false
                        }
                    }, enabled = !busy) { Text("Sync now") }
                    OutlinedButton({ confirmUnpair = true }, enabled = !busy) { Text("Unpair") }
                    if (busy) CircularProgressIndicator(Modifier.size(24.dp), strokeWidth = 3.dp)
                }
                if (message.isNotEmpty()) Text(message)
            }
        } else {
            SectionCard("1. On your computer") {
                Text("At home, open WaterCat Settings → 📱 Phone sync and turn on \"Sync with my phone over Wi-Fi\". Connect the phone to the same home Wi-Fi.")
            }
            SectionCard("🏠 Home Wi-Fi only") {
                val ssid = if (permTick >= 0) HomeWifi.currentSsid(ctx) else null
                Text("The Wi-Fi you pair on becomes your home Wi-Fi: WaterCat only syncs there and sends nothing on other networks.")
                if (ssid != null) Text("You're on: $ssid", fontWeight = FontWeight.SemiBold)
                else {
                    Text(HomeWifi.whyNoSsid(ctx), color = MaterialTheme.colorScheme.primary)
                    if (!HomeWifi.hasPermission(ctx)) LocationPermissionButton { permTick++ }
                }
            }
            SectionCard("2. Find it") {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                    Button({
                        busy = true
                        message = ""
                        scope.launch {
                            val list = SyncClient.discover(ctx)
                            found = list
                            if (list.size == 1) address = "${list[0].host}:${list[0].port}"
                            busy = false
                        }
                    }, enabled = !busy) { Text("🔍 Search Wi-Fi") }
                    if (busy) CircularProgressIndicator(Modifier.size(24.dp), strokeWidth = 3.dp)
                }
                found?.let { list ->
                    if (list.isEmpty()) Text("No computer answered. Type the address shown in WaterCat Settings instead.", color = MaterialTheme.colorScheme.onSurfaceVariant)
                    list.forEach { c ->
                        val sel = address == "${c.host}:${c.port}"
                        Card(Modifier.fillMaxWidth().clickable { address = "${c.host}:${c.port}" },
                            colors = CardDefaults.cardColors(containerColor = if (sel) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surfaceVariant)) {
                            Column(Modifier.padding(12.dp)) {
                                Text("🖥 ${c.name}", fontWeight = FontWeight.SemiBold)
                                Text("${c.host}:${c.port}", fontSize = 13.sp)
                            }
                        }
                    }
                }
                OutlinedTextField(address, { address = it.trim() }, label = { Text("Computer address") }, placeholder = { Text("192.168.1.20:47823") },
                    singleLine = true, modifier = Modifier.fillMaxWidth(), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri))
            }
            SectionCard("3. Pair") {
                OutlinedTextField(code, { v -> code = v.filter { it.isDigit() }.take(6) }, label = { Text("6-digit code from WaterCat Settings") },
                    singleLine = true, modifier = Modifier.fillMaxWidth(), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword))
                Button({
                    val hp = SyncClient.parseAddress(address)
                    if (hp == null) { message = "Type the computer's address first"; return@Button }
                    busy = true
                    message = ""
                    scope.launch {
                        val r = SyncClient.pair(ctx, hp.first, hp.second, code)
                        message = r.fold({ "Paired with $it 🎉" }, { it.message ?: "Pairing failed" })
                        if (r.isSuccess) code = ""
                        busy = false
                    }
                }, enabled = !busy && code.length == 6 && address.isNotBlank(), modifier = Modifier.fillMaxWidth()) { Text("Pair") }
                if (message.isNotEmpty()) Text(message, color = MaterialTheme.colorScheme.primary)
                if (s.syncError.isNotEmpty() && message.isEmpty()) Text("⚠ ${s.syncError}", color = MaterialTheme.colorScheme.primary)
            }
        }
        Text("Sync stays on your Wi-Fi: nothing goes to the internet.", fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.fillMaxWidth(), textAlign = TextAlign.Center)
    }
    if (confirmUnpair) {
        AlertDialog(
            onDismissRequest = { confirmUnpair = false },
            title = { Text("Unpair?") },
            text = { Text("This phone stops syncing with ${s.desktopName}. Your cups and alarms stay on both.") },
            confirmButton = { TextButton({ confirmUnpair = false; scope.launch { SyncClient.unpair(ctx); message = "" } }) { Text("Unpair") } },
            dismissButton = { TextButton({ confirmUnpair = false }) { Text("Cancel") } },
        )
    }
}
