package com.serthekk.watercat

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import java.io.File
import java.util.zip.GZIPInputStream
import kotlin.math.abs

/**
 * The Kotlin renderer against scenes rendered by the DESKTOP code (catsprite.js), exported by
 * scripts/export_sprites.js: every cell, whisker line and box must match.
 */
class SpriteGoldenTest {
    private val data = SpriteData(JSONObject(File("src/main/assets/catsprite.json").readText()))
    private val golden = JSONArray(GZIPInputStream(javaClass.getResourceAsStream("/sprite_golden.json.gz")!!).bufferedReader().readText())
    private val codes = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"

    private fun colors(o: JSONObject?) = o?.keys()?.asSequence()?.associateWith { hexColor(o.getString(it)) } ?: emptyMap()

    private fun options(o: JSONObject): SceneOptions {
        val l = o.getJSONObject("look")
        val look = Look(colors(l.optJSONObject("colors")), l.optString("pattern", "solid"), l.optString("ears", "normal"), l.optBoolean("fluffy"), l.optBoolean("tufts"),
            l.optBoolean("tail", true), l.optBoolean("whiskers", true), l.optInt("lookDx", 0), l.optString("mood", ""))
        val acc = o.optJSONObject("accessories")?.let { a -> a.keys().asSequence().associateWith { Worn(a.getJSONObject(it).optBoolean("on"), colors(a.getJSONObject(it).optJSONObject("colors"))) } } ?: emptyMap()
        val place = o.optJSONObject("place")
        return SceneOptions(o.getString("pose"), o.getString("frame"), look, o.optInt("facing", 1), place?.optInt("dx", 0) ?: 0, place?.optInt("dy", 0) ?: 0,
            o.optString("spot").ifEmpty { null }, colors(o.optJSONObject("spotColors")), o.optBoolean("overlay"), acc,
            o.optString("seasonal").ifEmpty { null }, o.optBoolean("hat"), o.optString("kneadProp").ifEmpty { null }, o.optString("catName"))
    }

    private fun decode(rows: JSONArray, palette: JSONArray): List<List<Int?>> = (0 until rows.length()).map { y ->
        rows.getString(y).map { ch -> if (ch == '.') null else palette.getString(codes.indexOf(ch)).toLong(16).toInt() }
    }

    private fun box(o: JSONObject?) = o?.let { Box(it.getInt("x"), it.getInt("y"), it.getInt("w"), it.getInt("h")) }

    @Test fun everySceneMatchesTheDesktop() {
        var cells = 0
        for (i in 0 until golden.length()) {
            val g = golden.getJSONObject(i)
            val o = options(g.getJSONObject("options"))
            val name = "${o.pose}/${o.frame} facing ${o.facing} ${g.getJSONObject("options").getJSONObject("look").optString("label")} spot=${o.spot} acc=${o.accessories.keys} hat=${o.hat}"
            val s = data.renderScene(o)
            val palette = g.getJSONArray("palette")
            for ((layer, mine) in listOf("under" to s.under, "over" to s.over)) {
                val want = decode(g.getJSONArray(layer), palette)
                for (y in want.indices) for (x in want[y].indices) {
                    if (want[y][x] != mine[y][x]) fail("$name: $layer cell $x,$y is ${mine[y][x]?.toUInt()?.toString(16)}, desktop ${want[y][x]?.toUInt()?.toString(16)}")
                    cells++
                }
            }
            val w = g.getJSONArray("whiskers")
            assertEquals("$name whiskers", w.length(), s.whiskers.size)
            for (k in 0 until w.length()) for (j in 0 until 4) assertTrue("$name whisker $k", abs(w.getJSONArray(k).getDouble(j) - s.whiskers[k][j]) < 1e-9)
            assertEquals("$name catBox", box(g.optJSONObject("catBox")), s.catBox)
            assertEquals("$name hatBox", box(g.optJSONObject("hatBox")), s.hatBox)
            val t = g.optJSONObject("tag")
            assertEquals("$name tag", t?.let { NameTag(it.getInt("x"), it.getInt("y"), it.getInt("w"), it.getInt("h"), it.getString("text")) }, s.tag)
        }
        println("sprite golden: ${golden.length()} scenes, $cells cells identical to the desktop")
    }

    /** A contact sheet of the scenes (build/sprite-preview.png), to look at the cats. */
    @Test fun previewSheet() {
        val cell = 4
        val per = 12
        val n = golden.length()
        val width = per * data.cols * cell
        val height = ((n + per - 1) / per) * data.rows * cell
        val px = IntArray(width * height) { 0xfffff6ea.toInt() }
        for (i in 0 until n) {
            val s = data.renderScene(options(golden.getJSONObject(i).getJSONObject("options")))
            val ox = (i % per) * data.cols * cell
            val oy = (i / per) * data.rows * cell
            for (layer in listOf(s.under, s.over)) for (y in 0 until data.rows) for (x in 0 until data.cols) layer[y][x]?.let { c ->
                for (dy in 0 until cell) for (dx in 0 until cell) {
                    val k = (oy + y * cell + dy) * width + ox + x * cell + dx
                    px[k] = blend(px[k], c)
                }
            }
        }
        File("build").mkdirs()
        File("build/sprite-preview.png").writeBytes(png(width, height, px))
    }

    private fun blend(bg: Int, fg: Int): Int {
        val a = (fg ushr 24) / 255.0
        fun ch(sh: Int) = (((fg shr sh) and 255) * a + ((bg shr sh) and 255) * (1 - a)).toInt()
        return (0xff shl 24) or (ch(16) shl 16) or (ch(8) shl 8) or ch(0)
    }

    private fun png(w: Int, h: Int, px: IntArray): ByteArray {
        val raw = java.io.ByteArrayOutputStream()
        for (y in 0 until h) {
            raw.write(0)
            for (x in 0 until w) { val c = px[y * w + x]; raw.write((c shr 16) and 255); raw.write((c shr 8) and 255); raw.write(c and 255) }
        }
        val out = java.io.ByteArrayOutputStream()
        fun chunk(type: String, d: ByteArray) {
            val b = java.nio.ByteBuffer.allocate(4).putInt(d.size).array()
            out.write(b)
            val td = type.toByteArray() + d
            out.write(td)
            val crc = java.util.zip.CRC32().apply { update(td) }.value.toInt()
            out.write(java.nio.ByteBuffer.allocate(4).putInt(crc).array())
        }
        out.write(byteArrayOf(-119, 80, 78, 71, 13, 10, 26, 10))
        chunk("IHDR", java.nio.ByteBuffer.allocate(13).putInt(w).putInt(h).put(8).put(2).put(0).put(0).put(0).array())
        val z = java.io.ByteArrayOutputStream()
        java.util.zip.DeflaterOutputStream(z).use { it.write(raw.toByteArray()) }
        chunk("IDAT", z.toByteArray())
        chunk("IEND", ByteArray(0))
        return out.toByteArray()
    }
}
