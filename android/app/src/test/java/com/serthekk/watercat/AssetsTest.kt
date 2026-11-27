package com.serthekk.watercat

import org.json.JSONArray
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

class AssetsTest {
    private val repo = generateSequence(File("").absoluteFile) { it.parentFile }.first { File(it, "assets/meows/meows.json").exists() }

    @Test fun everyDesktopMeowIsOnThePhone() {
        val desktop = JSONArray(File(repo, "assets/meows/meows.json").readText())
        val ids = (0 until desktop.length()).map { desktop.getJSONObject(it).getString("id") }.toSet()
        assertEquals(ids, Meow.entries.map { it.id }.toSet())
        for (m in Meow.entries) assertTrue("res/raw for ${m.id}", File(repo, "android/app/src/main/res/raw/meow_${m.id.replace('-', '_')}.ogg").exists())
    }

    @Test fun rawResourceNamesAreValid() {
        val names = File(repo, "android/app/src/main/res/raw").list()!!.map { it.substringBeforeLast('.') }
        assertTrue(names.isNotEmpty())
        names.forEach { assertTrue("bad res/raw name: $it", Regex("^[a-z][a-z0-9_]*$").matches(it)) }
    }
}
