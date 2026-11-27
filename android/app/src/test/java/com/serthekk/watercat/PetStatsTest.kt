package com.serthekk.watercat

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Locale

class PetStatsTest {
    @Test fun friendshipLevels() {
        assertEquals("New friends", PetStats.friendship(0).name)
        assertEquals(0.5f, PetStats.friendship(75).progress, 0.001f)
        assertEquals("Purr pals", PetStats.friendship(150).name)
        assertEquals("Snuggle buddies", PetStats.friendship(150).nextName)
        assertEquals("Snuggle buddies", PetStats.friendship(999).name)
        val top = PetStats.friendship(100_000)
        assertEquals("Soulmates", top.name)
        assertEquals(1f, top.progress, 0f)
        assertNull(top.nextName)
        assertEquals(0, PetStats.friendship(-5).level)
    }

    @Test fun ageCountsTheFirstDay() {
        assertEquals(1, PetStats.ageDays("2026-11-27", "2026-11-27"))
        assertEquals(25, PetStats.ageDays("2026-11-03", "2026-11-27"))
        assertEquals(1, PetStats.ageDays("2026-12-01", "2026-11-27")) // clock trouble: never 0 or less
    }

    @Test fun measuresAreHersAndStable() {
        val a = PetStats.measures("gargorl", 25, fluffy = false)
        assertEquals(a, PetStats.measures("gargorl", 25, fluffy = false))
        assertNotEquals(a, PetStats.measures("fainu", 25, fluffy = false))
        assertTrue(a.weightKg in 2.5f..5.5f && a.heightCm in 20f..28f && a.whiskersCm in 5f..8f)
        assertTrue(PetStats.measures("gargorl", 300, false).weightKg > a.weightKg) // a little more of her over time
        assertTrue(PetStats.measures("gargorl", 25, true).weightKg > a.weightKg) // fluff counts
        val (w, h, x) = PetStats.Measures(4f, 25.4f, 7.62f).format(Locale.US)
        assertEquals("8.8 lb", w); assertEquals("10.0 in", h); assertEquals("3.0 in", x)
        assertEquals("4.0 kg", PetStats.Measures(4f, 25.4f, 7.62f).format(Locale.UK).first)
    }

    @Test fun friendCodeIsStableAndReadable() {
        val c = PetStats.friendCode("android-1234")
        assertEquals(10, c.length)
        assertEquals(c, PetStats.friendCode("android-1234"))
        assertNotEquals(c, PetStats.friendCode("android-5678"))
        assertTrue(c.none { it in "01OIL" })
    }

    @Test fun threeDifferentTraitsPerCat() {
        val t = PetStats.traits("gargorl")
        assertEquals(3, t.size)
        assertEquals(3, t.toSet().size)
        assertEquals(t, PetStats.traits("gargorl"))
    }

    @Test fun greetingsByTimeOfDay() {
        assertTrue(CatLines.greeting(8, "G").startsWith("Good morning"))
        assertTrue(CatLines.greeting(14, "Gargorl").contains("Gargorl"))
        assertTrue(CatLines.greeting(2, "G").startsWith("Up late"))
    }
}
