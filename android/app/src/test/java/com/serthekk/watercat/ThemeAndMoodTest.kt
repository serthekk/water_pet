package com.serthekk.watercat

import androidx.compose.ui.graphics.luminance
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.util.Calendar

class ThemeAndMoodTest {
    private val themes = DesktopTheme.parse(JSONObject(File("src/main/assets/themes.json").readText()))

    @Test fun everyDesktopThemeBecomesAReadableScheme() {
        assertEquals(listOf("cream", "lavender", "blossom", "sunflower", "matcha", "harvest", "maple", "plum", "twilight"), themes.map { it.id })
        for (t in themes) {
            val s = t.scheme()
            fun contrast(a: androidx.compose.ui.graphics.Color, b: androidx.compose.ui.graphics.Color): Double {
                val (hi, lo) = listOf(a.luminance() + 0.05, b.luminance() + 0.05).sortedDescending()
                return (hi / lo).toDouble()
            }
            assertTrue("${t.id}: text on background", contrast(s.onBackground, s.background) >= 4.5)
            assertTrue("${t.id}: text on cards", contrast(s.onSurface, s.surface) >= 4.5)
            assertEquals("${t.id}: dark flag", t.dark, s.background.luminance() < 0.5f)
        }
    }

    private fun at(h: Int, m: Int = 0) = Calendar.getInstance().apply { set(Calendar.HOUR_OF_DAY, h); set(Calendar.MINUTE, m) }

    @Test fun moodFollowsTheDesktop() {
        // waking hours 08:00-23:00 (quiet 23:00-08:00), goal 8
        assertEquals("happy", catMood(8, 8, "23:00", "08:00", at(9)))
        assertEquals("happy", catMood(0, 8, "23:00", "08:00", at(8))) // nothing expected yet
        assertEquals("ok", catMood(3, 8, "23:00", "08:00", at(15, 30))) // expected 4, one behind
        assertEquals("sad", catMood(1, 8, "23:00", "08:00", at(17))) // expected 4.8: well behind
        assertEquals("sad", catMood(2, 8, "23:00", "08:00", at(2))) // after bedtime the whole day counts
        assertEquals("happy", catMood(4, 8, "12:00", "12:00", at(15))) // no quiet hours: 08:00-22:00
    }

    @Test fun whiskersAreThinPixelLines() {
        val sq = whiskerSquares(listOf(doubleArrayOf(0.0, 0.0, 4.0, 0.0)), 12f)
        assertEquals(25, sq.size) // 48 px long, 2 px squares
        assertTrue(sq.all { it.second == -1f })
        assertEquals(sq.size, sq.toSet().size)
    }

    @Test fun seasonalOutfitsByDate() {
        val d = SpriteData(JSONObject(File("src/main/assets/catsprite.json").readText()))
        assertEquals("santa", d.seasonalFor(2026, 11, 3))
        assertEquals("heartpin", d.seasonalFor(2026, 1, 14))
        assertEquals("witch", d.seasonalFor(2026, 9, 31))
        assertEquals("bunny", d.seasonalFor(2026, 3, 5)) // Easter 2026: 5 April
        assertEquals(null, d.seasonalFor(2026, 6, 1))
    }
}
