package com.serthekk.watercat

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

class CatProfileTest {
    private val sprites = SpriteData(JSONObject(File("src/main/assets/catsprite.json").readText()))

    // what the desktop sends (main.js phoneCat) for a fresh Fainu
    private val fromDesktop = """{"id":"fainu","name":"Fainu","gender":"unspecified","description":"A tiny calico tornado","preset":"fainu",
        "colors":{"furBase":"#fff6ea","patchA":"#e8913a","patchB":"#4a4040","outline":"#3b2f2f"},"pattern":"calico","earStyle":"normal","fluffy":false,"tufts":false,
        "tail":true,"whiskersEnabled":true,"accessories":{"bow":{"on":true,"colors":{"a":"#112233"}},"crown":{"on":false,"colors":{}}},
        "sleepSpot":"box","sleepSpotColors":{"boxCardboard":"#998877"},"lookLocked":true,"someFutureField":42}"""

    @Test fun readsTheDesktopCat() {
        val c = CatProfile.parse(fromDesktop)!!
        assertEquals("Fainu", c.name)
        assertEquals("They/Them", c.pronouns)
        assertEquals("calico", c.look().pattern)
        assertEquals(hexColor("#e8913a"), c.look().colors["patchA"])
        assertEquals(Worn(true, mapOf("a" to hexColor("#112233"))), c.worn()["bow"])
        assertFalse(c.worn().getValue("crown").on)
        assertEquals("box", c.spotFor("2026-11-27"))
        assertEquals(hexColor("#998877"), c.spotColors()["boxCardboard"])
    }

    @Test fun editsKeepEverythingElse() {
        val c = CatProfile.parse(fromDesktop)!!
        val e = c.withName("  Fainu   the Great ").withPreset(sprites.presets.getValue("orangetabby")).wearing("scarf", true).wearing("bow", false)
        assertEquals("Fainu the Great", e.name)
        assertEquals("orangetabby", e.preset)
        assertFalse("a look edit unlocks the look", e.json.getBoolean("lookLocked"))
        assertEquals("tabby", e.look().pattern)
        assertTrue(e.isWearing("scarf"))
        assertFalse(e.isWearing("bow"))
        assertEquals("#112233", e.json.getJSONObject("accessories").getJSONObject("bow").getJSONObject("colors").getString("a")) // her bow colour kept
        assertEquals(42, e.json.getInt("someFutureField")) // unknown desktop fields go back unchanged
        assertEquals("fainu", e.id)
        assertEquals("Fainu", c.name) // the original is not changed
    }

    @Test fun defaultIsGargorlAndRandomSpotsChangeDaily() {
        val g = CatProfile.default(sprites)
        assertEquals("Gargorl", g.name)
        assertEquals("She/Her", g.pronouns)
        assertEquals(sprites.presets.getValue("gargorl").look.colors, g.look().colors)
        val spots = (1..28).map { g.spotFor("2026-02-%02d".format(it)) }.toSet()
        assertTrue(spots.all { it in setOf("bed", "tree", "box") })
        assertTrue(spots.size > 1)
    }

    @Test fun catSyncsAsOneField() {
        val sent = State(catJson = "", stamps = emptyMap())
        val req = SyncProtocol.request(sent, 1000, "Pixel").getJSONObject("settings").getJSONObject("cat")
        assertTrue(req.isNull("v"))
        assertEquals(0L, req.getLong("t"))
        val edited = sent.copy(catJson = CatProfile.default(sprites).withName("Mochi").json.toString(), stamps = mapOf("cat" to 500L))
        assertEquals("Mochi", SyncProtocol.request(edited, 1000, "Pixel").getJSONObject("settings").getJSONObject("cat").getJSONObject("v").getString("name"))
        val answer = JSONObject().put("settings", JSONObject().put("cat", JSONObject().put("v", JSONObject(fromDesktop)).put("t", 900L)))
        val merged = SyncProtocol.apply(edited, edited, answer, 2000)
        assertEquals("Fainu", merged.cat(sprites).name)
        assertEquals(900L, merged.stamps["cat"])
        val bad = JSONObject().put("settings", JSONObject().put("cat", JSONObject().put("v", JSONObject().put("name", "")).put("t", 950L)))
        assertNotEquals("", SyncProtocol.apply(edited, edited, bad, 2000).cat(sprites).name)
    }
}
