package com.serthekk.watercat

import org.json.JSONObject

/**
 * The cat, as the desktop describes its active cat to the phone (main.js phoneCat):
 * { id, name, gender, description, preset, colors, pattern, earStyle, fluffy, tufts, tail,
 *   whiskersEnabled, accessories: { id: { on, colors } }, sleepSpot, sleepSpotColors, lookLocked }.
 * Kept as JSON, so whatever the desktop sends goes back unchanged; it syncs as ONE field
 * ("cat", newest change wins).
 */
class CatProfile(val json: JSONObject) {
    val id: String get() = json.optString("id", "gargorl")
    val name: String get() = json.optString("name").ifBlank { "Gargorl" }
    val gender: String get() = json.optString("gender", "unspecified")
    val description: String get() = json.optString("description")
    val preset: String get() = json.optString("preset", "gargorl")
    val sleepSpot: String get() = json.optString("sleepSpot", "random")
    val tail: Boolean get() = json.optBoolean("tail", true)
    val whiskers: Boolean get() = json.optBoolean("whiskersEnabled", true)

    /** "She/Her", "He/Him", "They/Them" (the desktop's three genders). */
    val pronouns: String get() = when (gender) { "female" -> "She/Her"; "male" -> "He/Him"; else -> "They/Them" }

    fun look(): Look {
        val c = json.optJSONObject("colors")
        val colors = c?.keys()?.asSequence()?.mapNotNull { k -> runCatching { k to hexColor(c.getString(k)) }.getOrNull() }?.toMap() ?: emptyMap()
        return Look(colors, json.optString("pattern", "solid"), json.optString("earStyle", "normal"), json.optBoolean("fluffy"), json.optBoolean("tufts"), tail, whiskers)
    }

    fun worn(): Map<String, Worn> {
        val a = json.optJSONObject("accessories") ?: return emptyMap()
        return a.keys().asSequence().associateWith { id ->
            val w = a.optJSONObject(id)
            val c = w?.optJSONObject("colors")
            Worn(w?.optBoolean("on") == true, c?.keys()?.asSequence()?.mapNotNull { k -> runCatching { k to hexColor(c.getString(k)) }.getOrNull() }?.toMap() ?: emptyMap())
        }
    }

    fun isWearing(item: String) = json.optJSONObject("accessories")?.optJSONObject(item)?.optBoolean("on") == true

    fun spotColors(): Map<String, Int> {
        val c = json.optJSONObject("sleepSpotColors") ?: return emptyMap()
        return c.keys().asSequence().mapNotNull { k -> runCatching { k to hexColor(c.getString(k)) }.getOrNull() }.toMap()
    }

    /** Where she sleeps tonight ("random" = a different spot every day, never "none"). */
    fun spotFor(day: String): String = when (sleepSpot) {
        "bed", "tree", "box" -> sleepSpot
        "none" -> "none"
        else -> listOf("bed", "tree", "box")[Math.floorMod(day.hashCode(), 3)]
    }

    private fun copy(f: JSONObject.() -> Unit) = CatProfile(JSONObject(json.toString()).apply(f))

    fun withName(n: String) = copy { put("name", n.replace(Regex("\\s+"), " ").trim().take(40)) }
    fun withGender(g: String) = copy { put("gender", g) }
    fun withDescription(d: String) = copy { put("description", d.take(200)) }
    fun withTail(on: Boolean) = copy { put("tail", on) }
    fun withWhiskers(on: Boolean) = copy { put("whiskersEnabled", on) }
    fun withSleepSpot(s: String) = copy { put("sleepSpot", s) }

    /** A coat preset: its whole look (the desktop does the same when a preset is picked). Unlocks the look. */
    fun withPreset(p: Preset) = copy {
        put("preset", p.id)
        put("colors", JSONObject().apply { p.look.colors.forEach { (k, v) -> put(k, hex(v)) } })
        put("pattern", p.look.pattern)
        put("earStyle", p.look.ears)
        put("fluffy", p.look.fluffy)
        put("tufts", p.look.tufts)
        put("lookLocked", false)
    }

    fun wearing(item: String, on: Boolean) = copy {
        val a = optJSONObject("accessories") ?: JSONObject().also { put("accessories", it) }
        val w = a.optJSONObject(item) ?: JSONObject().put("colors", JSONObject()).also { a.put(item, it) }
        w.put("on", on)
    }

    override fun equals(other: Any?) = other is CatProfile && other.json.toString() == json.toString()
    override fun hashCode() = json.toString().hashCode()

    companion object {
        fun hex(c: Int) = "#%06x".format(c and 0xffffff)

        /** Before the first sync: Gargorl, like a fresh desktop app (her look is not locked here). */
        fun default(sprites: SpriteData): CatProfile {
            val base = CatProfile(JSONObject().put("id", "gargorl").put("name", "Gargorl").put("gender", "female").put("description", "")
                .put("tail", true).put("whiskersEnabled", true).put("accessories", JSONObject()).put("sleepSpot", "random").put("sleepSpotColors", JSONObject()))
            return base.withPreset(sprites.presets.getValue("gargorl")).copy { put("lookLocked", true) }
        }

        fun parse(text: String): CatProfile? = runCatching { JSONObject(text) }.getOrNull()?.takeIf { it.optString("name").isNotBlank() }?.let { CatProfile(it) }
    }
}

/** The cat on this phone (Gargorl until the first sync or edit). */
fun State.cat(sprites: SpriteData): CatProfile = CatProfile.parse(catJson) ?: CatProfile.default(sprites)

/** An edit of the cat on the phone: newest change wins at the next sync (soon). */
fun editCat(ctx: android.content.Context, f: (CatProfile) -> CatProfile) {
    val sprites = SpriteData.get(ctx)
    Store.get(ctx).edit("cat") { s -> s.copy(catJson = f(s.cat(sprites)).json.toString()) }
    SyncWorker.syncSoon(ctx)
}
