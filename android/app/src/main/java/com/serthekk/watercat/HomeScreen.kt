package com.serthekk.watercat

import android.widget.Toast
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.clipPath
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.viewmodel.compose.viewModel
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.util.Calendar
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.sin

/** Her speech bubble: one line at a time, gone after a few seconds. */
class Bubble {
    var text by mutableStateOf<String?>(null); private set
    private var serial by mutableIntStateOf(0)
    fun say(line: String) { text = line; serial++ }
    internal val key get() = serial
    internal fun clear() { text = null }
}

/** The home screen: her scene, the big glass, today's goals, the streak, reminders. */
@Composable
internal fun TodayScreen(s: State, now: Long, vm: HomeViewModel = viewModel()) {
    val ctx = LocalContext.current
    val view = LocalView.current
    val sound = SoundManager.get(ctx)
    val sprites = SpriteData.get(ctx)
    val ui by vm.ui.collectAsState()
    val today = dayKey(now)
    val cups = s.total(today)
    val me = s.cat(sprites)
    val cat = remember { CatState() }
    val bubble = remember { Bubble() }
    var partyOn by remember { mutableStateOf(false) }
    LaunchedEffect(partyOn) { if (partyOn) { delay(20_500); partyOn = false } }
    val nowCal = remember(now) { Calendar.getInstance().apply { timeInMillis = now } }
    val sleeping = isQuietAt(nowCal.get(Calendar.HOUR_OF_DAY) * 60 + nowCal.get(Calendar.MINUTE), s.quietStart, s.quietEnd)
    LaunchedEffect(Unit) { // a hello when the app opens
        delay(600)
        bubble.say(when {
            sleeping -> CatLines.sleeping
            ui.streak.welcomeBack -> GameRules.streakLine(ui.streak, me.name)
            s.nagging -> CatLines.thirsty
            else -> CatLines.greeting(nowCal.get(Calendar.HOUR_OF_DAY), me.name)
        })
    }

    // every reward: a sound + a light haptic + she reacts (from the event, never from composition)
    fun drank() {
        val party = Actions.addCup(ctx)
        sound.cupLogged()
        sound.haptic(view)
        cat.play("happy"); cat.hop(); cat.hearts(3)
        bubble.say(if (party) CatLines.waterGoal else CatLines.drink.random())
        if (party) { sound.startParty(); partyOn = true }
    }

    Page {
        PermissionBanner()
        if (partyOn) Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.secondaryContainer), shape = MaterialTheme.shapes.large) {
            Row(Modifier.fillMaxWidth().padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
                Text("🎉 Goal reached! Party time!", Modifier.weight(1f), fontWeight = FontWeight.Bold)
                TextButton({ sound.stopParty(); partyOn = false }) { Text("Stop the party") }
            }
        }
        // her scene
        Card(Modifier.fillMaxWidth(), shape = MaterialTheme.shapes.large, elevation = CardDefaults.cardElevation(2.dp)) {
            Box(Modifier.fillMaxWidth().aspectRatio(1.25f)) {
                Scene(nowCal, night = sleeping, modifier = Modifier.matchParentSize())
                PixelCat(
                    cat, me.look(),
                    accessories = me.worn(), spot = me.spotFor(today), spotColors = me.spotColors(),
                    mood = catMood(cups, s.goalCups, s.quietStart, s.quietEnd, nowCal),
                    seasonal = sprites.seasonalFor(nowCal.get(Calendar.YEAR), nowCal.get(Calendar.MONTH), nowCal.get(Calendar.DAY_OF_MONTH)),
                    hat = s.partyShownDate == today, sleeping = sleeping, catName = me.name,
                    modifier = Modifier.align(Alignment.BottomCenter).padding(bottom = 18.dp).fillMaxWidth(0.66f).aspectRatio(30f / 27f)
                        // tap = a drink (like clicking her on the desktop), hold = nose boop, stroke = pet
                        .pointerInput(Unit) {
                            detectTapGestures(onTap = { drank() }, onLongPress = {
                                sound.squeak(); sound.haptic(view); cat.play("boop"); cat.hop(); cat.hearts(2); bubble.say(CatLines.boop.random())
                            })
                        }
                        .pointerInput(Unit) {
                            var travel = 0f
                            detectDragGestures(onDragStart = { travel = 0f }) { change, d ->
                                change.consume()
                                travel += d.getDistance()
                                if (travel > 140.dp.toPx()) {
                                    travel = 0f; sound.purr(3.2f); sound.haptic(view); cat.play("belly"); cat.hearts(5); bubble.say(CatLines.pet.random())
                                }
                            }
                        },
                )
                SpeechBubble(bubble, Modifier.align(Alignment.TopCenter).padding(top = 14.dp, start = 24.dp, end = 24.dp))
            }
            EnergyBar(ui, me.name)
        }
        WaterCard(s, cups, ::drank)
        GoalsSection(ui, s, onReward = { r, allDone ->
            sound.chirp(sound.quietNow()); sound.haptic(view)
            cat.play("happy"); cat.hearts(2)
            bubble.say(if (allDone) CatLines.allDone else CatLines.goalDone.random())
        }, vm = vm)
        StreakCard(ui.streak, me.name) { WeekChart(s, now) }
        RemindersCard(s, now)
        if (s.paired) Text(syncLine(s, now), color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.fillMaxWidth(), textAlign = TextAlign.Center, fontSize = 13.sp)
    }
}

// --- the scene: sky by time of day, sun / moon, hills, grass, flowers -------------
@Composable
private fun Scene(now: Calendar, night: Boolean, modifier: Modifier) {
    val hour = now.get(Calendar.HOUR_OF_DAY)
    val dark = night || hour < 6 || hour >= 21
    val dusk = !dark && hour >= 17
    val drift by rememberInfiniteTransition(label = "clouds").animateFloat(0f, 1f, infiniteRepeatable(tween(60_000, easing = LinearEasing)), label = "drift")
    Canvas(modifier) {
        val w = size.width
        val h = size.height
        val sky = when { dark -> listOf(Color(0xFF1F2547), Color(0xFF3B3266)); dusk -> listOf(Color(0xFFF7B2A0), Color(0xFFFDE8C8)); else -> listOf(Color(0xFFBFE6FF), Color(0xFFFFF6EA)) }
        drawRect(Brush.verticalGradient(sky))
        if (dark) {
            listOf(0.1f to 0.12f, 0.25f to 0.3f, 0.42f to 0.08f, 0.6f to 0.22f, 0.86f to 0.34f, 0.72f to 0.1f, 0.33f to 0.45f).forEach { (x, y) ->
                drawRect(Color(0xFFFFF6D5), Offset(w * x, h * y), Size(w * 0.012f, w * 0.012f))
            }
            drawCircle(Color(0xFFFFF3C4), w * 0.075f, Offset(w * 0.82f, h * 0.17f))
            drawCircle(sky[0], w * 0.07f, Offset(w * 0.79f, h * 0.15f)) // crescent
        } else {
            val sun = Offset(w * 0.82f, h * 0.17f)
            for (i in 0 until 12) rotate(i * 30f, sun) {
                drawRoundRect(Color(0xFFFFD86B), Offset(sun.x - w * 0.008f, sun.y - w * 0.12f), Size(w * 0.016f, w * 0.03f), CornerRadius(w * 0.008f))
            }
            drawCircle(if (dusk) Color(0xFFFFB05C) else Color(0xFFFFD23F), w * 0.07f, sun)
            for ((x0, y, s) in listOf(Triple(0.1f, 0.18f, 1f), Triple(0.55f, 0.1f, 0.7f))) {
                val x = ((x0 + drift) % 1.2f - 0.1f) * w
                val c = Color.White.copy(alpha = 0.9f)
                drawRoundRect(c, Offset(x, h * y), Size(w * 0.2f * s, h * 0.06f * s), CornerRadius(h * 0.03f * s))
                drawCircle(c, h * 0.045f * s, Offset(x + w * 0.07f * s, h * y))
                drawCircle(c, h * 0.035f * s, Offset(x + w * 0.13f * s, h * y + h * 0.005f))
            }
        }
        val ground = h * 0.78f
        drawCircle(if (dark) Color(0xFF2E4A47) else Color(0xFFA8D8A0), w * 0.55f, Offset(w * 0.15f, ground + w * 0.38f))
        drawCircle(if (dark) Color(0xFF355550) else Color(0xFF94CC8A), w * 0.6f, Offset(w * 0.95f, ground + w * 0.45f))
        drawRect(if (dark) Color(0xFF3C5F4F) else Color(0xFF7CBF6E), Offset(0f, ground), Size(w, h - ground))
        drawRect(if (dark) Color(0xFF4A7060) else Color(0xFF9AD48B), Offset(0f, ground), Size(w, h * 0.015f))
        val px = w * 0.014f
        listOf(0.08f to Color(0xFFFF8FB1), 0.2f to Color(0xFFFFE07A), 0.86f to Color(0xFFFF8FB1), 0.93f to Color(0xFFB9A2FF), 0.7f to Color(0xFFFFE07A)).forEach { (x, c) ->
            val fx = w * x
            val fy = ground + h * 0.07f
            drawRect(Color(0xFF4F8F45), Offset(fx, fy), Size(px, px * 3))
            drawRect(c, Offset(fx - px, fy - px), Size(px * 3, px))
            drawRect(c, Offset(fx, fy - px * 2), Size(px, px * 3))
            drawRect(Color(0xFFFFF6D5), Offset(fx, fy - px), Size(px, px))
        }
    }
}

@Composable
private fun SpeechBubble(b: Bubble, modifier: Modifier) {
    LaunchedEffect(b.key) { if (b.text != null) { delay(4_000); b.clear() } }
    AnimatedVisibility(b.text != null, modifier, enter = fadeIn() + scaleIn(initialScale = 0.8f), exit = fadeOut()) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Surface(shape = RoundedCornerShape(18.dp), color = Color.White, shadowElevation = 2.dp) {
                Text(b.text ?: "", Modifier.padding(horizontal = 16.dp, vertical = 10.dp), color = Color(0xFF3B2F2F), fontWeight = FontWeight.Bold, textAlign = TextAlign.Center)
            }
            Canvas(Modifier.size(16.dp, 9.dp)) {
                drawPath(Path().apply { moveTo(0f, 0f); lineTo(size.width, 0f); lineTo(size.width * 0.35f, size.height); close() }, Color.White)
            }
        }
    }
}

/** Today's sips toward her exploring trip (step 5 sends her out at the end of the bar). */
@Composable
private fun EnergyBar(ui: HomeUi, name: String) {
    val p by animateFloatAsState(ui.adventureProgress, tween(700, easing = FastOutSlowInEasing), label = "energy")
    Column(Modifier.padding(horizontal = 16.dp, vertical = 12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("💧 Energy", fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
            Text("${ui.wallet.sipsToday.coerceAtMost(GameRules.ADVENTURE_SIPS)} / ${GameRules.ADVENTURE_SIPS} sips", color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 13.sp)
        }
        LinearProgressIndicator(progress = { p }, Modifier.fillMaxWidth().height(12.dp).clip(RoundedCornerShape(6.dp)),
            color = Color(0xFF5FB4E8), trackColor = MaterialTheme.colorScheme.surfaceVariant, drawStopIndicator = {})
        Text(if (p >= 1f) "$name has the energy for an adventure! (exploring arrives in the next update)" else "Goals and glasses give sips. A full bar and $name goes exploring.",
            fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

// --- the big glass ---------------------------------------------------------------
@Composable
private fun WaterCard(s: State, cups: Int, onDrink: () -> Unit) {
    val ctx = LocalContext.current
    val goal = s.goalCups
    val fill by animateFloatAsState((cups.toFloat() / goal).coerceIn(0f, 1f), tween(900, easing = FastOutSlowInEasing), label = "fill")
    val wave by rememberInfiniteTransition(label = "wave").animateFloat(0f, (2 * PI).toFloat(), infiniteRepeatable(tween(2200, easing = LinearEasing), RepeatMode.Restart), label = "phase")
    val squash = remember { Animatable(1f) }
    val scope = rememberCoroutineScope()
    val ink = MaterialTheme.colorScheme.onSurface
    SectionCard {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(
                Modifier.size(150.dp).scale(squash.value).shadow(4.dp, CircleShape).clip(CircleShape).background(MaterialTheme.colorScheme.primaryContainer)
                    .clickable(remember { MutableInteractionSource() }, indication = androidx.compose.material3.ripple()) {
                        onDrink()
                        scope.launch { squash.snapTo(0.9f); squash.animateTo(1f, spring(dampingRatio = Spring.DampingRatioHighBouncy, stiffness = Spring.StiffnessMedium)) }
                    },
                contentAlignment = Alignment.Center,
            ) {
                Canvas(Modifier.size(84.dp, 100.dp)) {
                    val w = size.width
                    val h = size.height
                    val glass = Path().apply { moveTo(0f, 0f); lineTo(w, 0f); lineTo(w * 0.84f, h); lineTo(w * 0.16f, h); close() }
                    clipPath(glass) {
                        drawRect(Color.White.copy(alpha = 0.55f))
                        val top = h * (1 - fill)
                        val water = Path().apply {
                            moveTo(0f, h)
                            var x = 0f
                            while (x <= w) { lineTo(x, top + sin(x / w * 2 * PI.toFloat() * 1.5f + wave) * h * 0.025f * (if (fill in 0.01f..0.99f) 1f else 0f)); x += w / 24 }
                            lineTo(w, h); close()
                        }
                        drawPath(water, Color(0xFF5FB4E8))
                        drawRect(Color.White.copy(alpha = 0.35f), Offset(w * 0.2f, h * 0.08f), Size(w * 0.08f, h * 0.7f))
                    }
                    drawPath(glass, ink, style = Stroke(width = 3.dp.toPx(), join = StrokeJoin.Round))
                }
            }
            Spacer(Modifier.width(18.dp))
            Column(Modifier.weight(1f)) {
                Text("$cups / $goal", fontSize = 40.sp, fontWeight = FontWeight.ExtraBold)
                Text(s.drinkWord + " today", color = MaterialTheme.colorScheme.onSurfaceVariant, fontWeight = FontWeight.SemiBold)
                Spacer(Modifier.height(6.dp))
                Text(
                    when {
                        cups >= goal -> "Goal reached 🎉"
                        cups == 0 -> "Tap the glass (or her) when you drink. Each glass = ${GameRules.SIPS_PER_GLASS} 💧"
                        else -> "${goal - cups} more to go · +${GameRules.SIPS_PER_GLASS} 💧 each"
                    },
                    fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                TextButton({ if (!Actions.undoCup(ctx)) Toast.makeText(ctx, "Nothing to undo on this phone", Toast.LENGTH_SHORT).show() },
                    contentPadding = androidx.compose.foundation.layout.PaddingValues(0.dp)) { Text("Undo last glass") }
            }
        }
    }
}

// --- goals ---------------------------------------------------------------------------
@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun GoalsSection(ui: HomeUi, s: State, onReward: (Reward, Boolean) -> Unit, vm: HomeViewModel) {
    var editing by remember { mutableStateOf<GoalEntity?>(null) }
    var adding by remember { mutableStateOf(false) }
    Row(Modifier.fillMaxWidth().padding(top = 4.dp), verticalAlignment = Alignment.CenterVertically) {
        Text("📋", fontSize = 22.sp)
        Spacer(Modifier.width(8.dp))
        Text(if (ui.goals.isNotEmpty() && ui.goalsLeft == 0) "All done for today! 🎉" else "${ui.goalsLeft} goal${if (ui.goalsLeft == 1) "" else "s"} left for today!",
            style = MaterialTheme.typography.titleLarge, modifier = Modifier.weight(1f))
        Text("🐟 ${ui.wallet.treats}", fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.primary)
    }
    ui.goals.forEach { row ->
        val g = row.goal
        val pop by animateFloatAsState(if (row.done) 1f else 0f, spring(dampingRatio = Spring.DampingRatioMediumBouncy), label = "check")
        Card(Modifier.fillMaxWidth().combinedClickable(onClick = {}, onLongClick = { editing = g }), shape = MaterialTheme.shapes.large,
            elevation = CardDefaults.cardElevation(1.dp), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)) {
            Row(Modifier.padding(horizontal = 14.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(46.dp).clip(CircleShape).background(MaterialTheme.colorScheme.primaryContainer), contentAlignment = Alignment.Center) { Text(g.icon, fontSize = 24.sp) }
                Spacer(Modifier.width(12.dp))
                Column(Modifier.weight(1f)) {
                    Text(g.title, fontWeight = FontWeight.ExtraBold, fontSize = 17.sp)
                    if (g.kind == "water") Text("${s.total(ui.today)} / ${s.goalCups} ${s.drinkWord} · checks itself", fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                Text("${g.sips} 💧", fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Spacer(Modifier.width(10.dp))
                val allDoneAfter = !row.done && ui.goals.count { !it.done } == 1
                Box(
                    Modifier.size(54.dp).clip(RoundedCornerShape(16.dp))
                        .background(if (row.done) MaterialTheme.colorScheme.tertiary else MaterialTheme.colorScheme.surfaceContainerHighest)
                        .clickable(enabled = g.kind != "water") { vm.toggle(g) { r -> onReward(r, allDoneAfter) } },
                    contentAlignment = Alignment.Center,
                ) {
                    Canvas(Modifier.size(26.dp).scale(0.6f + 0.4f * pop)) {
                        val c = if (pop > 0.01f) Color.White.copy(alpha = pop.coerceIn(0f, 1f)) else Color.Transparent
                        drawPath(Path().apply { moveTo(size.width * 0.12f, size.height * 0.55f); lineTo(size.width * 0.42f, size.height * 0.82f); lineTo(size.width * 0.9f, size.height * 0.2f) },
                            c, style = Stroke(width = 4.dp.toPx(), cap = StrokeCap.Round, join = StrokeJoin.Round))
                    }
                }
            }
        }
    }
    OutlinedButton({ adding = true }, Modifier.fillMaxWidth().height(52.dp), shape = MaterialTheme.shapes.large) { Text("＋  Add a goal") }
    Text("Hold a goal to edit, move or remove it.", fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.fillMaxWidth(), textAlign = TextAlign.Center)
    if (adding) GoalDialog(null, onDismiss = { adding = false }, onSave = { t, i, n -> vm.addGoal(t, i, n); adding = false })
    editing?.let { g ->
        GoalDialog(g, onDismiss = { editing = null }, onSave = { t, i, n -> vm.editGoal(g, t, i, n); editing = null },
            onRemove = { vm.removeGoal(g); editing = null }, onMove = { by -> vm.move(g, by) })
    }
}

// --- streak ---------------------------------------------------------------------------
/** "N day streak" with the sun-and-check badge; tap for [details]. */
@Composable
internal fun StreakCard(st: GameRules.Streak, name: String, details: (@Composable () -> Unit)? = null) {
    var open by remember { mutableStateOf(false) }
    Card(Modifier.fillMaxWidth().clickable(enabled = details != null) { open = !open }, shape = MaterialTheme.shapes.large,
        elevation = CardDefaults.cardElevation(1.dp), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)) {
        Column(Modifier.padding(16.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                SunBadge(st.doneToday, Modifier.size(64.dp))
                Spacer(Modifier.width(14.dp))
                Column(Modifier.weight(1f)) {
                    Row(verticalAlignment = Alignment.Bottom) {
                        Text("${st.current}", fontSize = 30.sp, fontWeight = FontWeight.ExtraBold)
                        Text(" day streak", fontSize = 20.sp, fontWeight = FontWeight.Bold, modifier = Modifier.padding(bottom = 3.dp))
                    }
                    Text(if (st.current > 1 && st.current >= st.best && st.doneToday) "Longest self-care streak ever!" else GameRules.streakLine(st, name),
                        color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 14.sp)
                }
                if (details != null) Text(if (open) "▴" else "▾", fontSize = 20.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            if (open && details != null) { Spacer(Modifier.height(10.dp)); details() }
        }
    }
}

/** A little sun with a check mark (grey-ish until today is done). */
@Composable
private fun SunBadge(done: Boolean, modifier: Modifier) {
    val spin by rememberInfiniteTransition(label = "sun").animateFloat(0f, 360f, infiniteRepeatable(tween(40_000, easing = LinearEasing)), label = "spin")
    Canvas(modifier) {
        val c = center
        val r = size.minDimension / 2
        val ray = if (done) Color(0xFFF2C230) else Color(0xFFE0D3B8)
        rotate(spin, c) {
            for (i in 0 until 12) {
                val a = (i * 30.0) * PI / 180
                val tip = Offset(c.x + cos(a).toFloat() * r, c.y + sin(a).toFloat() * r)
                val l = Offset(c.x + cos(a - 0.18).toFloat() * r * 0.68f, c.y + sin(a - 0.18).toFloat() * r * 0.68f)
                val rr = Offset(c.x + cos(a + 0.18).toFloat() * r * 0.68f, c.y + sin(a + 0.18).toFloat() * r * 0.68f)
                drawPath(Path().apply { moveTo(tip.x, tip.y); lineTo(l.x, l.y); lineTo(rr.x, rr.y); close() }, ray)
            }
        }
        drawCircle(if (done) Color(0xFFFFD23F) else Color(0xFFF0E6D2), r * 0.68f, c)
        drawCircle(if (done) Color(0xFFFFE27A) else Color(0xFFF7F0E2), r * 0.52f, c)
        drawPath(Path().apply { moveTo(c.x - r * 0.24f, c.y + r * 0.02f); lineTo(c.x - r * 0.05f, c.y + r * 0.2f); lineTo(c.x + r * 0.27f, c.y - r * 0.18f) },
            if (done) Color(0xFFE8913A) else Color(0xFFC8B89C), style = Stroke(width = r * 0.13f, cap = StrokeCap.Round, join = StrokeJoin.Round))
    }
}

// --- reminders (unchanged, moved) -------------------------------------------------------
@Composable
private fun RemindersCard(s: State, now: Long) {
    val ctx = LocalContext.current
    SectionCard("🔔 Reminders") {
        Text(reminderLine(ctx, s, now))
        if (s.remindersPaused(now)) {
            FilledTonalButton({ Actions.pauseReminders(ctx, 0) }) { Text("Resume reminders") }
        } else {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedButton({ Actions.pauseReminders(ctx, now + 3_600_000L) }) { Text("Pause 1 h") }
                OutlinedButton({
                    val c = Calendar.getInstance().apply { add(Calendar.DAY_OF_MONTH, 1); set(Calendar.HOUR_OF_DAY, toMinutes(s.quietEnd) / 60); set(Calendar.MINUTE, toMinutes(s.quietEnd) % 60); set(Calendar.SECOND, 0) }
                    Actions.pauseReminders(ctx, c.timeInMillis)
                }) { Text("Until tomorrow") }
            }
        }
        val next = s.alarms.filter { it.enabled }.minByOrNull { Scheduler.nextAlarmTime(it, now) }
        if (next != null && s.ringAlarms) Text("⏰ Next alarm: ${formatHHMM(ctx, next.time)} · ${next.text}", color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

