package com.serthekk.watercat

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/** Database upgrades only ADD things: every table of an older version is unchanged in the next (Room auto-migrates). */
class SchemaTest {
    private val dir = File("schemas/com.serthekk.watercat.GameDb")
    private fun tables(v: Int): Map<String, String> {
        val e = JSONObject(File(dir, "$v.json").readText()).getJSONObject("database").getJSONArray("entities")
        return (0 until e.length()).associate { e.getJSONObject(it).getString("tableName") to e.getJSONObject(it).getString("createSql") }
    }

    @Test fun version2KeepsVersion1AndAddsAdventures() {
        val v1 = tables(1)
        val v2 = tables(2)
        for ((name, sql) in v1) assertEquals("table $name changed", sql, v2[name])
        assertEquals(setOf("adventures"), v2.keys - v1.keys)
        assertTrue(v2.getValue("adventures").contains("`returnsAt` INTEGER NOT NULL"))
    }
}
