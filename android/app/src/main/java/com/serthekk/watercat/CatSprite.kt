package com.serthekk.watercat

import org.json.JSONArray
import org.json.JSONObject
import kotlin.math.floor
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt
import kotlin.math.sign

/*
 * The desktop cat's pixel renderer (catsprite.js), ported to Kotlin.
 *
 * The art itself (letter grids, anchors, coats, items) is data, exported from the desktop
 * by scripts/export_sprites.js into assets/catsprite.json. This file is the logic that turns
 * it into coloured cells; it follows catsprite.js line by line (render, renderScene,
 * accessoryCells, hatPlace, spotCells, whiskerLines), and SpriteGoldenTest checks it against
 * scenes rendered by the desktop code itself, cell for cell.
 *
 * Colours are ARGB ints; a grid is [row][col], null = empty.
 */

typealias Grid = Array<Array<Int?>>

fun hexColor(s: String): Int {
    if (s.startsWith("#")) return (0xff000000 or s.substring(1).toLong(16)).toInt()
    val m = Regex("""rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)""").find(s) ?: error("colour $s")
    val (r, g, b, a) = m.destructured
    return ((a.toDouble() * 255).roundToInt() shl 24) or (r.toInt() shl 16) or (g.toInt() shl 8) or b.toInt()
}

/** JavaScript's Math.round (halves round up, also for negatives). */
private fun jsRound(d: Double): Int = floor(d + 0.5).toInt()

/** catsprite.js shade(): darker version of a colour. */
fun shade(c: Int, k: Double = 0.78): Int {
    fun f(v: Int) = jsRound(v * k).coerceIn(0, 255)
    return (0xff shl 24) or (f((c shr 16) and 255) shl 16) or (f((c shr 8) and 255) shl 8) or f(c and 255)
}

class Prop(val rows: List<String>, val colors: Map<Char, Int>)
class Item(val id: String, val label: String, val slot: String, val unlock: Boolean, val colors: Map<String, Int>)
class Preset(val id: String, val label: String, val description: String, val unlock: Boolean, val look: Look)
class Drink(val id: String, val label: String, val word: String, val grid: List<String>?, val colors: Map<Char, Int>)
private class Layout(val col: Int, val face: DoubleArray, val whiskers: String, val post: Int?)
private class Anchor(val head: DoubleArray, val earR: DoubleArray, val eyes: DoubleArray, val eyesSide: String, val neck: DoubleArray, val neckDir: String)

/** A cat's look (one desktop cat profile's colours + shape options). */
data class Look(
    val colors: Map<String, Int> = emptyMap(), // part -> colour (missing parts = Gargorl's)
    val pattern: String = "solid",
    val ears: String = "normal",
    val fluffy: Boolean = false,
    val tufts: Boolean = false,
    val tail: Boolean = true,
    val whiskers: Boolean = true,
    val lookDx: Int = 0, // pupils -1 / 0 / +1 (sitting)
    val mood: String = "", // "sad" = flattened ears + heavy lids (sitting)
)

data class Worn(val on: Boolean, val colors: Map<String, Int> = emptyMap())

data class SceneOptions(
    val pose: String = "sit",
    val frame: String = "sit",
    val look: Look = Look(),
    val facing: Int = 1,
    val placeDx: Int = 0,
    val placeDy: Int = 0,
    val spot: String? = null,
    val spotColors: Map<String, Int> = emptyMap(),
    val overlay: Boolean = false,
    val accessories: Map<String, Worn> = emptyMap(),
    val seasonal: String? = null,
    val hat: Boolean = false,
    val kneadProp: String? = null,
    val catName: String = "",
)

data class Box(val x: Int, val y: Int, val w: Int, val h: Int)
data class NameTag(val x: Int, val y: Int, val w: Int, val h: Int, val text: String)

/** under = behind a spot's front edge, over = in front of her. whiskers: [x1, y1, x2, y2] in cells. */
class Scene(val under: Grid, val over: Grid, val whiskers: List<DoubleArray>, val catBox: Box?, val hatBox: Box?, val tag: NameTag?)

class SpriteData(json: JSONObject) {
    val cols: Int = json.getJSONObject("canvas").getInt("cols")
    val rows: Int = json.getJSONObject("canvas").getInt("rows")
    val parts: List<String> = json.getJSONArray("parts").strings()
    val patterns: List<String> = json.getJSONArray("patterns").strings()
    val poses: Map<String, List<String>> = json.getJSONObject("poses").let { o -> o.keys().asSequence().associateWith { o.getJSONArray(it).strings() } }
    private val frames: Map<String, Map<String, List<String>>> = json.getJSONObject("frames").let { o ->
        o.keys().asSequence().associateWith { p -> o.getJSONObject(p).let { f -> f.keys().asSequence().associateWith { f.getJSONArray(it).strings() } } }
    }
    private val layout: Map<String, Layout> = json.getJSONObject("layout").let { o ->
        o.keys().asSequence().associateWith { k ->
            val l = o.getJSONObject(k)
            Layout(l.getInt("col"), l.getJSONArray("face").doubles(), l.getString("whiskers"), if (l.has("post")) l.getInt("post") else null)
        }
    }
    private val whiskerSets: Map<String, List<DoubleArray>> = json.getJSONObject("whiskers").let { o ->
        o.keys().asSequence().associateWith { k -> o.getJSONArray(k).let { a -> (0 until a.length()).map { a.getJSONArray(it).doubles() } } }
    }
    private val lookEdits: Map<Int, List<Triple<Int, Int, Char>>> = json.getJSONObject("lookEdits").let { o -> o.keys().asSequence().associate { it.toInt() to edits(o.getJSONArray(it)) } }
    private val sadEdits = edits(json.getJSONArray("sadEdits"))
    private val post = prop(json.getJSONObject("post"))
    val heart = prop(json.getJSONObject("heart"))
    val partyHat = prop(json.getJSONObject("partyHat"))
    val discoBall = prop(json.getJSONObject("discoBall"))
    val presets: Map<String, Preset> = json.getJSONObject("presets").let { o ->
        o.keys().asSequence().associateWith { id ->
            val p = o.getJSONObject(id)
            Preset(id, p.getString("label"), p.optString("description"), p.optBoolean("unlock"),
                Look(colorMap(p.getJSONObject("colors")), p.optString("pattern", "solid"), p.optString("ears", "normal"), p.optBoolean("fluffy"), p.optBoolean("tufts")))
        }
    }
    private val gargorl: Map<String, Int> = presets.getValue("gargorl").look.colors
    val accessories: Map<String, Item> = items(json.getJSONObject("accessories"))
    val seasonal: Map<String, Item> = items(json.getJSONObject("seasonal"))
    private val seasonalGrid: Map<String, String> = json.getJSONObject("seasonalGrid").let { o -> o.keys().asSequence().associateWith { o.getString(it) } }
    val unlocks: JSONObject = json.getJSONObject("unlocks")
    private val itemGrids: Map<String, List<String>> = json.getJSONObject("itemGrids").let { o -> o.keys().asSequence().associateWith { o.getJSONArray(it).strings() } }
    private val anchors: Map<String, Anchor> = json.getJSONObject("anchors").let { o ->
        o.keys().asSequence().associateWith { k ->
            val a = o.getJSONObject(k)
            val eyes = a.getJSONArray("eyes")
            val neck = a.getJSONArray("neck")
            val side = when (val v = eyes.get(2)) { true -> "side"; false -> "front"; else -> v.toString() }
            Anchor(a.getJSONArray("head").doubles(), a.getJSONArray("earR").doubles(), doubleArrayOf(eyes.getDouble(0), eyes.getDouble(1)), side,
                doubleArrayOf(neck.getDouble(0), neck.getDouble(1), neck.getDouble(3)), neck.getString(2))
        }
    }
    private val spots: Map<String, Triple<Int, List<String>, Int>> = json.getJSONObject("spots").let { o ->
        o.keys().asSequence().associateWith { k -> o.getJSONObject(k).let { Triple(it.getInt("col"), it.getJSONArray("rows").strings(), it.getInt("frontFrom")) } }
    }
    val spotIds: List<String> get() = spots.keys.toList()
    val spotDefaultColors: Map<String, Int> = colorMap(json.getJSONObject("spotDefaultColors"))
    val spotParts: Map<String, List<String>> = json.getJSONObject("spotParts").let { o -> o.keys().asSequence().associateWith { o.getJSONArray(it).strings() } }
    private val kneadProps: Map<String, Prop> = json.getJSONObject("kneadProps").let { o ->
        o.keys().asSequence().associateWith { k -> o.getJSONObject(k).let { Prop(it.getJSONArray("grid").strings(), charColors(it.getJSONObject("colors"))) } }
    }
    val drinks: Map<String, Drink> = json.getJSONObject("drinks").let { o ->
        o.keys().asSequence().associateWith { id ->
            val d = o.getJSONObject(id)
            Drink(id, d.getString("label"), d.getString("word"), d.optJSONArray("grid")?.strings(), d.optJSONObject("colors")?.let { charColors(it) } ?: emptyMap())
        }
    }

    private fun blank(): Grid = Array(rows) { arrayOfNulls<Int>(cols) }
    private fun framesOf(pose: String) = frames[pose] ?: frames.getValue("sit")
    private fun rowsOf(pose: String, frame: String) = framesOf(pose)[frame] ?: framesOf(pose).values.first()
    private fun layoutOf(pose: String) = layout[pose] ?: layout.getValue("sit")

    private fun setCells(rows: List<String>, edits: List<Triple<Int, Int, Char>>): List<String> {
        val out = rows.map { it.toCharArray() }
        for ((x, y, ch) in edits) if (y in out.indices && x >= 0 && x < out[y].size) out[y][x] = ch
        return out.map { String(it) }
    }

    // catsprite.js patternAt(): which fur pixels become patch A / B
    private fun patternAt(pattern: String, x: Int, y: Int, w: Int, face: DoubleArray): Char? = when (pattern) {
        "tabby" -> if ((y + x / 3) % 3 == 0) 'A' else null
        "tuxedo" -> if (hypot(x - face[0], (y - face[1] - 2) * 1.2) <= 2.6) 'B' else null
        "calico" -> if (x.toDouble() / w < 0.36) 'A' else if (x.toDouble() / w > 0.64) 'B' else null
        "spots" -> if ((x * 7 + y * 13) % 11 == 0) 'A' else null
        "points" -> if (hypot(x - face[0], (y - face[1]) * 1.3) <= 2.9) 'A' else null
        else -> null
    }

    private fun colorsOf(look: Look) = gargorl + look.colors
    private fun tailColor(look: Look, c: Map<String, Int>) = when (look.pattern) { "calico" -> c["patchB"]; "points" -> c["patchA"]; else -> c["tail"] }

    /** catsprite.js render(): one pose frame on the canvas. */
    fun render(pose: String, frame: String, look: Look, facing: Int = 1, pdx: Int = 0, pdy: Int = 0): Grid {
        val c = colorsOf(look)
        val lay = layoutOf(pose)
        var rows = rowsOf(pose, frame)
        if (pose == "sit" && look.lookDx != 0) rows = setCells(rows, lookEdits[look.lookDx.sign] ?: emptyList())
        if (pose == "sit" && look.mood == "sad" && frame != "squint") rows = setCells(rows, sadEdits)
        val h = rows.size
        val w = rows.maxOf { it.length }
        val out = blank()
        val top = this.rows - h - pdy
        val tipRow = rows.indexOfFirst { 'X' in it }
        val earRow = rows.indexOfFirst { 'I' in it }
        fun put(gx: Int, gy: Int, col: Int?) { if (col != null && gx in 0 until cols && gy in 0 until this.rows) out[gy][gx] = col }
        fun cx(x: Int) = pdx + if (facing == -1) lay.col + (w - 1 - x) else lay.col + x
        if (lay.post != null) post.rows.forEachIndexed { y, r -> r.forEachIndexed { x, ch -> if (ch != '.') put(lay.post + x, this.rows - post.rows.size + y, post.colors[ch]) } }
        fun fur(x: Int, y: Int, ch: Char): Int? = when (patternAt(look.pattern, x, y, w, lay.face)) {
            'A' -> c["patchA"]
            'B' -> c["patchB"]
            else -> if (ch == 'S') c["furShade"] else c["furBase"]
        }
        for (y in 0 until h) for (x in rows[y].indices) {
            val col: Int? = when (val ch = rows[y][x]) {
                '.' -> null
                'K' -> c["outline"]
                'F', 'S' -> fur(x, y, ch)
                'M' -> c["muzzle"]
                'G' -> c["belly"]
                'C' -> c["cheeks"]
                'Y' -> c["eyes"]
                'P' -> c["pupils"]
                'W' -> c["eyeShine"]
                'U' -> if (look.ears == "fold") fur(x, y, 'F') else c["earOuter"]
                'I' -> if (look.ears == "fold") (if (y == earRow) c["outline"] else c["earOuter"]) else c["earInner"]
                'N' -> c["nose"]
                'O' -> c["mouth"]
                'D' -> c["paws"]
                'X' -> if (look.ears == "fold" || (look.ears == "small" && y == tipRow)) null else c["outline"]
                'Q' -> if (look.tufts && look.ears != "fold") c["outline"] else null
                'Z' -> if (look.fluffy) c["muzzle"] else null
                'T' -> if (!look.tail) null else when {
                    look.pattern == "calico" -> c["patchB"]
                    look.pattern == "points" -> c["patchA"]
                    look.pattern == "tabby" && x % 2 == 1 -> c["patchA"]
                    else -> c["tail"]
                }
                't' -> if (look.tail) c["outline"] else null
                'V' -> if (look.tail) tailColor(look, c) else fur(x, y, 'F')
                else -> error("catsprite: unknown letter \"$ch\" in $pose/$frame at $x,$y")
            }
            put(cx(x), top + y, col)
        }
        return out
    }

    /** catsprite.js whiskerLines(): [x1, y1, x2, y2] in canvas cells ([] with whiskers off). */
    fun whiskerLines(pose: String, frame: String, look: Look, facing: Int = 1, pdx: Int = 0, pdy: Int = 0): List<DoubleArray> {
        if (!look.whiskers) return emptyList()
        val lay = layoutOf(pose)
        val rows = rowsOf(pose, frame)
        val w = rows.maxOf { it.length }
        val top = this.rows - rows.size - pdy
        fun fx(x: Double) = pdx + if (facing == -1) lay.col + (w - x) else lay.col + x
        fun clipX(x: Double) = min(cols - 0.25, max(0.25, x))
        fun clipY(y: Double) = min(this.rows - 0.25, max(0.25, y))
        return (whiskerSets[lay.whiskers] ?: emptyList()).map { (x1, y1, x2, y2) -> doubleArrayOf(clipX(fx(x1)), clipY(top + y1), clipX(fx(x2)), clipY(top + y2)) }
    }

    /** catsprite.js spotCells(): one layer ("back" / "front") of a sleeping spot. */
    fun spotCells(spot: String, front: Boolean, spotColors: Map<String, Int>): List<Triple<Double, Double, Int>> {
        val (col, srows, frontFrom) = spots[spot] ?: return emptyList()
        val c = spotDefaultColors + spotColors
        val k = hexColor("#3b2f2f")
        val cmap: Map<Char, Int> = when (spot) {
            "bed" -> mapOf('K' to k, 'R' to c.getValue("bedRim"), 'r' to shade(c.getValue("bedRim")), 'C' to c.getValue("bedCushion"))
            "tree" -> mapOf('K' to k, 'C' to c.getValue("treeCarpet"), 'T' to c.getValue("treeTrim"), 'W' to c.getValue("treePostWrap"), 'w' to shade(c.getValue("treePostWrap")),
                'y' to hexColor("#ff6b8b"), 's' to hexColor("#d9d2c5"))
            "box" -> mapOf('K' to k, 'B' to c.getValue("boxCardboard"), 'b' to shade(c.getValue("boxCardboard")), 'F' to shade(c.getValue("boxCardboard"), 0.88),
                'I' to c.getValue("boxInside"), 'P' to c.getValue("boxTape"), 'L' to c.getValue("boxLabel"), 'l' to hexColor("#8a7a6a"), 'S' to hexColor("rgba(40,30,25,0.28)"))
            else -> emptyMap()
        }
        val top = rows - srows.size
        val out = ArrayList<Triple<Double, Double, Int>>()
        srows.forEachIndexed { y, r ->
            if (front != (y >= frontFrom)) return@forEachIndexed
            r.forEachIndexed { x, ch -> if (ch != '.') cmap[ch]?.let { out += Triple((col + x).toDouble(), (top + y).toDouble(), it) } }
        }
        return out
    }

    private fun spotOverlay(spot: String, look: Look): List<Triple<Int, Int, Int>> {
        val c = colorsOf(look)
        val outline = c.getValue("outline")
        return when (spot) {
            "tree" -> listOf(18 to 1, 19 to 1, 20 to 1, 18 to 2, 19 to 2, 20 to 2, 18 to 3, 19 to 3, 20 to 3, 18 to 4, 19 to 4, 20 to 4, 19 to 5).map { (x, y) ->
                Triple(x, y, if (x == 19 && y in 1..4) tailColor(look, c)!! else outline)
            }
            "box" -> listOf(Triple(6, 3, 'K'), Triple(7, 3, 'D'), Triple(8, 3, 'D'), Triple(9, 3, 'K'), Triple(6, 4, 'K'), Triple(7, 4, 'D'), Triple(8, 4, 'D'), Triple(9, 4, 'K'),
                Triple(7, 5, 'K'), Triple(8, 5, 'K')).map { (x, y, ch) -> Triple(x, y, if (ch == 'D') c.getValue("paws") else outline) }
            else -> emptyList()
        }
    }

    private fun kneadPropCells(kind: String): List<Triple<Double, Double, Int>> {
        val p = kneadProps[kind] ?: return emptyList()
        val w = p.rows[0].length
        val x0 = jsRound(14.5 - w / 2.0 + 0.5)
        val y0 = rows - p.rows.size
        val out = ArrayList<Triple<Double, Double, Int>>()
        p.rows.forEachIndexed { y, r -> r.forEachIndexed { x, ch -> p.colors[ch]?.let { out += Triple((x0 + x).toDouble(), (y0 + y).toDouble(), it) } } }
        return out
    }

    /** catsprite.js accessoryCells(): cells of all worn items for a pose (+ the name tag box). */
    fun accessoryCells(o: SceneOptions): Pair<List<Triple<Double, Double, Int>>, NameTag?> {
        val a = anchors["${o.pose}/${o.frame}"] ?: anchors[o.pose] ?: return emptyList<Triple<Double, Double, Int>>() to null
        val lay = layoutOf(o.pose)
        val w = rowsOf(o.pose, o.frame).maxOf { it.length }
        fun fx(x: Double) = o.placeDx + if (o.facing == -1) 2 * lay.col + w - 1 - x else x
        fun fy(y: Double) = y - o.placeDy
        val cells = ArrayList<Triple<Double, Double, Int>>()
        var tag: NameTag? = null
        val outlineK = hexColor("#2b2e35")
        val white = hexColor("#ffffff")
        fun stamp(grid: List<String>, colors: Map<String, Int>, x0: Int, y0: Int) {
            grid.forEachIndexed { y, row ->
                row.forEachIndexed { x, ch ->
                    if (ch == '.') return@forEachIndexed
                    val col = when (ch) { 'K' -> outlineK; 'w' -> white; else -> colors[ch.toString()] } ?: return@forEachIndexed
                    cells += Triple(jsRound(fx((x0 + x).toDouble())).toDouble(), jsRound(fy((y0 + y).toDouble())).toDouble(), col)
                }
            }
        }
        fun on(id: String) = o.accessories[id]?.on == true
        fun colorsOf(id: String) = accessories.getValue(id).colors + (o.accessories[id]?.colors ?: emptyMap())
        val headBlocked = o.hat || o.spot == "box"
        val earBlocked = o.spot == "box"
        val nx = a.neck[0]
        val ny = a.neck[1]
        val len = a.neck[2].toInt()
        val horizontal = a.neckDir == "h"
        fun band(col: Int, thick: Int = 1) {
            for (i in 0 until len) for (t in 0 until thick) {
                cells += if (horizontal) Triple(fx((jsRound(nx - len / 2.0 + 0.5) + i).toDouble()), fy(ny + t), col)
                else Triple(fx(nx + t), fy((jsRound(ny - len / 2.0 + 0.5) + i).toDouble()), col)
            }
        }
        fun below(dx: Double, dy: Double) = if (horizontal) doubleArrayOf(nx - 0.5 + dx, ny + 1 + dy) else doubleArrayOf(nx + sign(dx), ny + len / 2.0 + dy)
        for (id in listOf("scarf", "bandana", "bell", "nametag")) {
            if (!on(id)) continue
            val c = colorsOf(id)
            if (id == "scarf") {
                band(c.getValue("a"), 2)
                var i = 0
                while (i < len) {
                    cells += if (horizontal) Triple(fx((jsRound(nx - len / 2.0 + 0.5) + i).toDouble()), fy(ny), c.getValue("b"))
                    else Triple(fx(nx), fy((jsRound(ny - len / 2.0 + 0.5) + i).toDouble()), c.getValue("b"))
                    i += 2
                }
                for (t in 0 until 3) {
                    val ex = if (horizontal) nx + 2.5 else nx - 1
                    val ey = if (horizontal) ny + 2 + t else ny + 1.5 + t
                    cells += Triple(fx(jsRound(ex).toDouble()), fy(jsRound(ey).toDouble()), if (t % 2 == 1) c.getValue("b") else c.getValue("a"))
                    cells += Triple(fx((jsRound(ex) + 1).toDouble()), fy(jsRound(ey).toDouble()), c.getValue("a"))
                }
            } else {
                band(c.getValue("a"))
                if (id == "bandana") {
                    val rowsN = if (horizontal) 3 else 2
                    for (r in 1..rowsN) {
                        val half = if (horizontal) max(0, floor((len - 2.0 * r) / 2).toInt()) else rowsN - r
                        for (k in -half..half) {
                            val bx = if (horizontal) nx - 0.5 + k else nx + k
                            val by = if (horizontal) ny + r else ny + len / 2.0 - 0.5 + r
                            cells += Triple(fx(jsRound(bx).toDouble()), fy(jsRound(by).toDouble()), if ((r + k) % 3 == 0) c.getValue("b") else c.getValue("a"))
                        }
                    }
                }
                if (id == "bell" || id == "nametag") {
                    val (bx, by) = below(0.0, 0.0)
                    val grid = if (id == "bell") listOf("bbb", ".b.") else listOf("bbbb", "bbbb", "bbbb")
                    val gx = jsRound(bx - (grid[0].length - 1) / 2.0)
                    stamp(grid, c, gx, jsRound(by))
                    if (id == "nametag") {
                        val x1 = fx(gx.toDouble())
                        val x2 = fx((gx + grid[0].length - 1).toDouble())
                        tag = NameTag(min(x1, x2).toInt(), fy(jsRound(by).toDouble()).toInt(), grid[0].length, grid.size, o.catName.trim())
                    }
                }
            }
        }
        if (o.seasonal == "heartpin") {
            val (px, py) = if (horizontal) below(-3.0, 1.0) else doubleArrayOf(nx - 2, ny - 1)
            stamp(itemGrids.getValue("heartpin"), seasonal.getValue("heartpin").colors, jsRound(px - 1), jsRound(py))
        }
        for (id in listOf("glasses", "sunglasses", "heartglasses")) {
            if (!on(id)) continue
            val (ex, ey) = a.eyes
            val grid = itemGrids.getValue(id + when (a.eyesSide) { "small" -> "Small"; "side" -> "Side"; else -> "Front" })
            val gx = if (a.eyesSide == "side") jsRound(ex) - grid[0].length + 2 else jsRound(ex - (grid[0].length - 1) / 2.0)
            stamp(grid, colorsOf(id), gx, jsRound(ey - (grid.size - 1) / 2.0))
        }
        if (!headBlocked) {
            val (hx, hy) = a.head
            if (on("crown")) stamp(itemGrids.getValue("crown"), colorsOf("crown"), jsRound(hx - 3), (hy - 3).toInt())
            if (on("goldcrown")) stamp(itemGrids.getValue("goldcrown"), colorsOf("goldcrown"), jsRound(hx - 3), (hy - 4).toInt())
            if (on("flowercrown")) stamp(itemGrids.getValue("flowercrown"), colorsOf("flowercrown"), jsRound(hx - 4), (hy - 2).toInt())
            val s = o.seasonal?.takeIf { seasonal[it]?.slot == "head" }
            if (s != null) {
                val grid = itemGrids.getValue(seasonalGrid.getValue(s))
                stamp(grid, seasonal.getValue(s).colors, jsRound(hx - (grid[0].length - 1) / 2.0), (hy - grid.size + 1).toInt())
            }
        }
        if (!earBlocked && on("bow")) {
            val (bx, by) = a.earR
            stamp(itemGrids.getValue("bow"), colorsOf("bow"), (bx - 2).toInt(), by.toInt())
        }
        return cells to tag
    }

    /** catsprite.js hatPlace(): the party hat's top-left, its brim on her forehead. */
    fun hatPlace(o: SceneOptions, cat: Grid): Pair<Int, Int>? {
        val lay = layoutOf(o.pose)
        val w = rowsOf(o.pose, o.frame).maxOf { it.length }
        val fx = jsRound(lay.face[0])
        val hc = o.placeDx + if (o.facing == -1) lay.col + (w - 1 - fx) else lay.col + fx
        var top = -1
        for (y in 0 until rows) {
            if ((hc - 1..hc + 1).any { it in 0 until cols && cat[y][it] != null }) { top = y; break }
        }
        if (top < 0) return null
        return (hc - partyHat.rows[0].length / 2) to (top - partyHat.rows.size + 1)
    }

    /** catsprite.js renderScene(): spot back -> cat -> items -> hat; spot front + overlay on top. */
    fun renderScene(o: SceneOptions): Scene {
        val under = blank()
        val over = blank()
        // like JS array indexing: cells off the canvas or between cells are dropped
        fun paint(g: Grid, cells: List<Triple<Double, Double, Int>>) {
            for ((x, y, c) in cells) {
                if (x != floor(x) || y != floor(y)) continue
                if (x >= 0 && x < cols && y >= 0 && y < rows) g[y.toInt()][x.toInt()] = c
            }
        }
        val spot = o.spot?.takeIf { it in spots }
        if (spot != null) paint(under, spotCells(spot, false, o.spotColors))
        val cat = render(o.pose, o.frame, o.look, o.facing, o.placeDx, o.placeDy)
        for (y in 0 until rows) for (x in 0 until cols) cat[y][x]?.let { under[y][x] = it }
        if (spot != null) {
            paint(over, spotCells(spot, true, o.spotColors))
            if (o.overlay) {
                val top = rows - spots.getValue(spot).second.size
                val col = spots.getValue(spot).first
                paint(over, spotOverlay(spot, o.look).map { (x, y, c) -> Triple((col + x).toDouble(), (top + y).toDouble(), c) })
            }
        }
        var catBox: Box? = null
        run {
            var minX = Int.MAX_VALUE; var minY = Int.MAX_VALUE; var maxX = -1; var maxY = -1
            for (y in 0 until rows) for (x in 0 until cols) if (cat[y][x] != null && over[y][x] == null) {
                minX = min(minX, x); maxX = max(maxX, x); minY = min(minY, y); maxY = max(maxY, y)
            }
            if (maxX >= 0) catBox = Box(minX, minY, maxX - minX + 1, maxY - minY + 1)
        }
        if (o.pose == "knead" && o.kneadProp != null) paint(over, kneadPropCells(o.kneadProp))
        var tag: NameTag? = null
        if (o.accessories.isNotEmpty() || o.seasonal != null) {
            val (cells, t) = accessoryCells(o)
            paint(under, cells)
            tag = t
        }
        var hatBox: Box? = null
        if (o.hat) hatPlace(o, cat)?.let { (hx, hy) ->
            partyHat.rows.forEachIndexed { y, r ->
                r.forEachIndexed { x, ch ->
                    val c = partyHat.colors[ch] ?: return@forEachIndexed
                    if (hx + x in 0 until cols && hy + y in 0 until rows) under[hy + y][hx + x] = c
                }
            }
            hatBox = Box(hx, hy, partyHat.rows[0].length, partyHat.rows.size)
        }
        return Scene(under, over, whiskerLines(o.pose, o.frame, o.look, o.facing, o.placeDx, o.placeDy), catBox, hatBox, tag)
    }

    /** Which seasonal outfit fits a date (catsprite.js seasonalFor). month 0-11. */
    fun seasonalFor(year: Int, month: Int, day: Int): String? {
        if (month == 11) return "santa"
        if (month == 1 && day in 7..14) return "heartpin"
        if ((month == 9 && day >= 24) || (month == 10 && day == 1)) return "witch"
        val e = easterSunday(year)
        val days = java.time.temporal.ChronoUnit.DAYS.between(e, java.time.LocalDate.of(year, month + 1, day))
        return if (days in -7..7) "bunny" else null
    }

    companion object {
        fun easterSunday(year: Int): java.time.LocalDate {
            val a = year % 19; val b = year / 100; val c = year % 100; val d = b / 4; val e = b % 4
            val f = (b + 8) / 25; val gg = (b - f + 1) / 3; val h = (19 * a + b - d - gg + 15) % 30
            val i = c / 4; val k = c % 4; val l = (32 + 2 * e + 2 * i - h - k) % 7; val m = (a + 11 * h + 22 * l) / 451
            val month = (h + l - 7 * m + 114) / 31
            val day = ((h + l - 7 * m + 114) % 31) + 1
            return java.time.LocalDate.of(year, month, day)
        }

        @Volatile private var loaded: SpriteData? = null
        fun get(ctx: android.content.Context): SpriteData = loaded ?: synchronized(this) {
            loaded ?: SpriteData(JSONObject(ctx.assets.open("catsprite.json").bufferedReader().use { it.readText() })).also { loaded = it }
        }

        private fun JSONArray.strings() = (0 until length()).map { getString(it) }
        private fun JSONArray.doubles() = DoubleArray(length()) { getDouble(it) }
        private fun edits(a: JSONArray) = (0 until a.length()).map { a.getJSONArray(it).let { e -> Triple(e.getInt(0), e.getInt(1), e.getString(2)[0]) } }
        private fun colorMap(o: JSONObject) = o.keys().asSequence().associateWith { hexColor(o.getString(it)) }
        private fun charColors(o: JSONObject) = o.keys().asSequence().associate { it[0] to hexColor(o.getString(it)) }
        private fun prop(o: JSONObject) = Prop(o.getJSONArray("rows").strings(), charColors(o.getJSONObject("colors")))
        private fun items(o: JSONObject) = o.keys().asSequence().associateWith { id ->
            val i = o.getJSONObject(id)
            Item(id, i.getString("label"), i.getString("slot"), i.optBoolean("unlock"), colorMap(i.getJSONObject("colors")))
        }
    }
}
