package com.serthekk.watercat

import androidx.compose.foundation.Canvas
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameMillis
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.drawIntoCanvas
import androidx.compose.ui.graphics.nativeCanvas
import androidx.compose.ui.platform.LocalContext
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.delay
import kotlinx.coroutines.withTimeoutOrNull
import java.util.Calendar
import kotlin.math.ceil
import kotlin.math.floor
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/** One step of a desktop animation (renderer.js ANIMS): pose, frame, how long, pupils. */
private data class Step(val pose: String, val frame: String, val ms: Long, val lookDx: Int = 0)

/** renderer.js ANIMS, the same timings. */
private val ANIMS: Map<String, List<Step>> = mapOf(
    "stretch" to listOf(Step("stretch", "yawn", 350), Step("stretch", "tall", 1100), Step("stretch", "yawn", 300), Step("sit", "blink", 200)),
    "scratch" to List(12) { Step("scratch", if (it % 2 == 1) "b" else "a", 220) },
    "belly" to listOf(Step("belly", "a", 3000)),
    "boop" to listOf(Step("sit", "blink", 110), Step("sit", "sit", 120), Step("sit", "blink", 110), Step("sit", "squint", 500)),
    "happy" to listOf(Step("sit", "squint", 900), Step("sit", "blink", 120), Step("sit", "squint", 600)),
    "yawn" to listOf(Step("yawn", "yawn", 1100), Step("sit", "blink", 180), Step("sit", "sit", 200)),
    "groom" to List(10) { Step("groom", if (it % 2 == 1) "b" else "a", 260) } + Step("sit", "blink", 180),
    "look" to listOf(Step("sit", "sit", 800, -1), Step("sit", "blink", 140, -1), Step("sit", "sit", 900, 1), Step("sit", "sit", 500, 0)),
    "knead" to List(10) { Step("knead", if (it % 2 == 1) "b" else "a", 320) },
    "chomp" to listOf(Step("yawn", "yawn", 150), Step("sit", "squint", 150), Step("yawn", "yawn", 150), Step("sit", "squint", 150), Step("yawn", "yawn", 150), Step("sit", "squint", 900)),
    "tailcurl" to listOf(Step("sit", "wag", 600), Step("sit", "sit", 450), Step("sit", "wag", 900), Step("sit", "sit", 300), Step("sit", "wag", 400), Step("sit", "sit", 200)),
)
/** main.js IDLE_ANIMS: what she does now and then on her own. */
private val IDLE_MOVES = listOf("stretch", "scratch", "yawn", "groom", "look", "tailcurl")

/**
 * main.js catMood(): today's drinks against the time of day over her waking hours.
 * "happy" = on track or goal reached, "sad" = well behind (>= 2 drinks and >= 35 % of the goal).
 */
fun catMood(cups: Int, goal: Int, quietStart: String, quietEnd: String, now: Calendar = Calendar.getInstance()): String {
    if (cups >= goal) return "happy"
    val mins = now.get(Calendar.HOUR_OF_DAY) * 60 + now.get(Calendar.MINUTE)
    var start = toMinutes(quietEnd)
    var end = toMinutes(quietStart)
    if (start == end) { start = 8 * 60; end = 22 * 60 }
    val span = ((end - start + 1440) % 1440).let { if (it == 0) 1440 else it }
    val into = (mins - start + 1440) % 1440
    val f = if (into > span) 1.0 else into.toDouble() / span
    val expected = goal * f
    if (cups >= expected) return "happy"
    return if (expected - cups >= max(2.0, goal * 0.35)) "sad" else "ok"
}

internal class Heart(val id: Long, val start: Long, val dx: Float, val x: Float)

/** What the cat on screen is doing. Events (a drink, a boop, petting) go in through [play] / [hop] / [hearts]. */
class CatState {
    var pose by mutableStateOf("sit"); internal set
    var frame by mutableStateOf("sit"); internal set
    var lookDx by mutableIntStateOf(0); internal set
    internal var hopStart by mutableLongStateOf(0L)
    internal val heartList = mutableStateListOf<Heart>()
    internal val requests = Channel<String>(Channel.CONFLATED)
    private var nextHeart = 0L

    /** Plays one of the desktop animations ("happy", "boop", "belly", "knead", "chomp", ...). */
    fun play(name: String) { requests.trySend(name) }

    /** The desktop's little hop (0.32 s, two cells up, in four steps). */
    fun hop() { hopStart = System.currentTimeMillis() }

    /** Pixel hearts floating up from her head (one every 220 ms, like the desktop). */
    fun hearts(n: Int) {
        val now = System.currentTimeMillis()
        repeat(n) { heartList += Heart(nextHeart++, now + it * 220L, (Math.random().toFloat() - 0.5f) * 30f / 8f, 0.2f + Math.random().toFloat() * 0.6f) }
    }
}

/**
 * The desktop cat, drawn with the ported sprite renderer (CatSprite.kt): crisp whole-pixel
 * cells, whiskers as thin lines, the desktop's idle life (blinks, tail wags, stretches...),
 * hops and hearts. Sleeping (quiet hours): curled up in her spot with floating z's.
 */
@Composable
fun PixelCat(
    state: CatState,
    look: Look,
    modifier: Modifier = Modifier,
    mood: String = "ok",
    accessories: Map<String, Worn> = emptyMap(),
    seasonal: String? = null,
    hat: Boolean = false,
    sleeping: Boolean = false,
    spot: String = "bed",
    spotColors: Map<String, Int> = emptyMap(),
    catName: String = "",
) {
    val data = SpriteData.get(LocalContext.current)
    val moodNow by rememberUpdatedState(mood)

    // the animation driver: requests first, idle life in between (renderer.js runBase / idle)
    LaunchedEffect(state, sleeping) {
        var lastMove = System.currentTimeMillis()
        suspend fun run(steps: List<Step>) {
            for (s in steps) { state.pose = s.pose; state.frame = s.frame; state.lookDx = s.lookDx; delay(s.ms) }
        }
        fun rest() {
            if (sleeping) { state.pose = "sleep"; state.frame = "a" } else { state.pose = "sit"; state.frame = "sit" }
            state.lookDx = 0
        }
        rest()
        while (true) {
            val wait = if (sleeping) 1400L else 2200L + (Math.random() * 3800).toLong()
            val req = withTimeoutOrNull(wait) { state.requests.receive() }
            if (req != null) {
                if (!sleeping || req in setOf("happy", "boop")) ANIMS[req]?.let { run(it) }
                rest()
                continue
            }
            if (sleeping) { state.frame = if (state.frame == "a") "b" else "a"; continue }
            val now = System.currentTimeMillis()
            if (now - lastMove > 45_000 && Math.random() < 0.35) { // now and then one of her idle moves
                lastMove = now
                run(ANIMS.getValue(IDLE_MOVES.random()))
                rest()
                continue
            }
            // a happy cat wags more, a sad one not at all
            val wagChance = when (moodNow) { "sad" -> 0.0; "happy" -> 0.6; else -> 0.4 }
            if (Math.random() < wagChance) run(listOf(Step("sit", "wag", 220), Step("sit", "sit", 220), Step("sit", "wag", 220)))
            else run(listOf(Step("sit", "blink", 160)))
            rest()
        }
    }

    // a frame clock only while something moves (hop, hearts, z's)
    var clock by remember { mutableLongStateOf(System.currentTimeMillis()) }
    val moving = state.heartList.isNotEmpty() || clock - state.hopStart < 400 || sleeping
    LaunchedEffect(moving, state.hopStart) {
        while (true) {
            withFrameMillis { }
            clock = System.currentTimeMillis()
            state.heartList.removeAll { clock - it.start > 1600 }
            if (state.heartList.isEmpty() && clock - state.hopStart > 400 && !sleeping) break
            if (sleeping && state.heartList.isEmpty()) delay(250) // z's move in steps: 4 updates a second is plenty
        }
    }

    val spotCat = if (sleeping && state.pose == "sleep") spot else null
    val placeDy = when (spotCat) { "bed" -> 2; "tree" -> 16; "box" -> -5; else -> 0 }
    val options = SceneOptions(
        pose = state.pose, frame = state.frame,
        look = look.copy(lookDx = state.lookDx, mood = if (moodNow == "sad") "sad" else ""),
        placeDy = placeDy, spot = spotCat, spotColors = spotColors, overlay = spotCat == "tree" || spotCat == "box",
        accessories = accessories, seasonal = seasonal, hat = hat, catName = catName,
    )
    val scene = remember(options) { data.renderScene(options) }
    val hopCells = run {
        val t = clock - state.hopStart
        if (t < 0 || t >= 320) 0 else when ((t / 80).toInt()) { 0 -> 1; 1 -> 2; 2 -> 1; else -> 0 }
    }

    Canvas(modifier) {
        val cell = floor(min(size.width / data.cols, size.height / data.rows)).coerceAtLeast(1f)
        val ox = floor((size.width - data.cols * cell) / 2)
        val oy = floor(size.height - data.rows * cell) - hopCells * cell
        drawGrid(scene.under, ox, oy, cell)
        val t = max(1f, (cell / 6f).roundToInt().toFloat())
        val whiskerColor = Color(look.colors["whiskers"] ?: hexColor("#d9dbe0"))
        for ((x, y) in whiskerSquares(scene.whiskers, cell)) drawRect(whiskerColor, Offset(ox + x, oy + y), Size(t, t))
        drawGrid(scene.over, ox, oy, cell)
        // hearts: half-cell pixels, rising 7 cells in 8 steps over 1.6 s, fading in / out
        val hs = max(2f, (cell / 2).roundToInt().toFloat())
        val heart = data.heart
        val box = scene.catBox
        for (h in state.heartList) {
            val age = clock - h.start
            if (age < 0) continue
            val p = floor(min(1f, age / 1600f) * 8) / 8
            val alpha = when { p < 0.15f -> p / 0.15f; p > 0.75f -> (1 - p) / 0.25f; else -> 1f }.coerceIn(0f, 1f)
            val bx = (box?.x ?: 8) + (box?.w ?: 14) * h.x
            val baseX = ox + bx * cell - heart.rows[0].length * hs / 2 + h.dx * cell * p
            val baseY = oy + ((box?.y ?: 12) + 1) * cell - 7 * cell * p
            heart.rows.forEachIndexed { yy, r ->
                r.forEachIndexed { xx, ch ->
                    heart.colors[ch]?.let { drawRect(Color(it).copy(alpha = alpha), Offset(baseX + xx * hs, baseY + yy * hs), Size(hs, hs)) }
                }
            }
        }
        if (sleeping) drawZzz(ox, oy, cell, box)
    }
}

private fun DrawScope.drawGrid(g: Grid, ox: Float, oy: Float, cell: Float) {
    for (y in g.indices) for (x in g[y].indices) g[y][x]?.let { drawRect(Color(it), Offset(ox + x * cell, oy + y * cell), Size(cell, cell)) }
}

// z z z above her head while she sleeps (styles.css zfloat: 3 s, stepped, staggered by 1 s)
private fun DrawScope.drawZzz(ox: Float, oy: Float, cell: Float, box: Box?) {
    val now = System.currentTimeMillis()
    val x0 = ox + ((box?.x ?: 6) + 2) * cell
    val y0 = oy + ((box?.y ?: 18) - 1) * cell
    drawIntoCanvas { c ->
        for (i in 0 until 3) {
            val p = (((now + i * 1000L) % 3000L) / 3000f).let { floor(it * 12) / 12 }
            val alpha = when { p < 0.15f -> p / 0.15f; p > 0.8f -> (1 - p) / 0.2f; else -> 1f }
            val paint = android.graphics.Paint().apply {
                isAntiAlias = true
                textSize = cell * (1.8f + i * 0.4f)
                typeface = android.graphics.Typeface.create(android.graphics.Typeface.DEFAULT, android.graphics.Typeface.BOLD)
                color = android.graphics.Color.argb((alpha * 255).toInt(), 255, 255, 255)
                setShadowLayer(cell / 3, 0f, 0f, android.graphics.Color.argb((alpha * 255).toInt(), 29, 22, 22))
            }
            c.nativeCanvas.drawText("z", x0 + p * 3.2f * cell, y0 - p * 4.2f * cell, paint)
        }
    }
}

/** catsprite.js whiskerSquares(): thin pixel lines as squares of whole pixels (no smoothing). */
fun whiskerSquares(lines: List<DoubleArray>, cell: Float): List<Pair<Float, Float>> {
    val t = max(1, (cell / 6f).roundToInt())
    val out = ArrayList<Pair<Float, Float>>()
    val seen = HashSet<Long>()
    for ((x1, y1, x2, y2) in lines) {
        val ax = x1 * cell; val ay = y1 * cell; val bx = x2 * cell; val by = y2 * cell
        val n = max(1, ceil(hypot(bx - ax, by - ay) / t).toInt())
        for (i in 0..n) {
            val px = floor(ax + (bx - ax) * i / n - t / 2.0 + 0.5).toFloat()
            val py = floor(ay + (by - ay) * i / n - t / 2.0 + 0.5).toFloat()
            val key = (floor(px / t + 0.5).toLong() shl 32) or (floor(py / t + 0.5).toLong() and 0xffffffffL)
            if (seen.add(key)) out += px to py
        }
    }
    return out
}

