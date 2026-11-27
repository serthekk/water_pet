package com.serthekk.watercat

import java.security.MessageDigest
import java.util.Locale
import kotlin.math.abs

/*
 * The cat's profile numbers, as plain functions (PetStatsTest): age, friendship level, cute
 * stats, friend code, personality, and the things she says. Everything is derived from what
 * is already stored (adoption day, total sips, her id), so nothing extra needs saving.
 */
object PetStats {
    /** Friendship grows with every sip ever earned (goals + glasses). */
    data class Friendship(val level: Int, val name: String, val heart: String, val progress: Float, val nextName: String?)

    private val LEVELS = listOf(
        Triple(0, "New friends", "🤍"),
        Triple(150, "Purr pals", "💗"),
        Triple(500, "Snuggle buddies", "💖"),
        Triple(1500, "Soulmates", "❤️"),
    )

    fun friendship(totalSips: Int): Friendship {
        val i = LEVELS.indexOfLast { totalSips >= it.first }.coerceAtLeast(0)
        val next = LEVELS.getOrNull(i + 1)
        val progress = if (next == null) 1f else (totalSips - LEVELS[i].first).toFloat() / (next.first - LEVELS[i].first)
        return Friendship(i, LEVELS[i].second, LEVELS[i].third, progress.coerceIn(0f, 1f), next?.second)
    }

    /** Days together, counting the first day as day 1. */
    fun ageDays(adoptedOn: String, today: String): Int = (GameRules.daysBetween(adoptedOn, today) + 1).coerceAtLeast(1)

    private fun hash(s: String): Int = MessageDigest.getInstance("SHA-256").digest(s.toByteArray()).let { (it[0].toInt() and 255) shl 8 or (it[1].toInt() and 255) }

    /** -1..1, the same for the same cat every time. */
    private fun wobble(id: String, salt: String) = (hash("$id/$salt") % 2001) / 1000f - 1f

    data class Measures(val weightKg: Float, val heightCm: Float, val whiskersCm: Float) {
        /** "3.9 kg" / "8.6 lb" etc., imperial for the US (like the phone's region). */
        fun format(locale: Locale = Locale.getDefault()): Triple<String, String, String> {
            val us = locale.country in setOf("US", "LR", "MM")
            return if (us) Triple("%.1f lb".format(locale, weightKg * 2.20462f), "%.1f in".format(locale, heightCm / 2.54f), "%.1f in".format(locale, whiskersCm / 2.54f))
            else Triple("%.1f kg".format(locale, weightKg), "%.0f cm".format(locale, heightCm), "%.1f cm".format(locale, whiskersCm))
        }
    }

    /** A grown cat's size, her own (by id), a little more of her the longer you're friends. */
    fun measures(catId: String, ageDays: Int, fluffy: Boolean): Measures {
        val grown = (ageDays.coerceAtMost(365) / 365f)
        return Measures(
            weightKg = 3.4f + wobble(catId, "w") * 0.7f + grown * 0.6f + if (fluffy) 0.8f else 0f,
            heightCm = 24f + wobble(catId, "h") * 2f + grown * 1.5f,
            whiskersCm = 6.5f + wobble(catId, "x") * 0.8f,
        )
    }

    /** Ten characters, no look-alike letters (no 0/O, 1/I/L), the same for this phone forever. */
    fun friendCode(deviceId: String): String {
        val alphabet = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"
        val d = MessageDigest.getInstance("SHA-256").digest("watercat-friend:$deviceId".toByteArray())
        return (0 until 10).map { alphabet[(d[it].toInt() and 255) % alphabet.length] }.joinToString("")
    }

    private val TRAITS = listOf(
        "Box inspector 📦", "Window watcher 🪟", "Midnight zoomies 🌙", "Professional napper 😴", "Treat detective 🐟",
        "Lap warmer 🛋️", "Keyboard sitter ⌨️", "Sunbeam chaser ☀️", "Chatty meower 🗣️", "Gentle head-booper 💞",
        "Yarn enthusiast 🧶", "Plant sniffer 🌿", "Blanket burrower 🧺", "Bird TV critic 🐦", "Water bowl splasher 💦",
    )

    /** Three traits of hers (by id: they don't change). */
    fun traits(catId: String): List<String> {
        val pool = TRAITS.toMutableList()
        return (0 until 3).map { i -> pool.removeAt(abs(hash("$catId/trait$i")) % pool.size) }
    }

    fun pronounWords(gender: String): Triple<String, String, String> = when (gender) {
        "female" -> Triple("she", "her", "her")
        "male" -> Triple("he", "him", "his")
        else -> Triple("they", "them", "their")
    }
}

/** What she says in her speech bubble (her own lines, cozy, never nagging). */
object CatLines {
    val drink = listOf("Sip sip hooray! 💧", "You got this! 🐾", "Hydration hero! ✨", "Purr-fect sip 💙", "One more for the bowl! 🥣", "So proud of you 😺")
    val goalDone = listOf("Look at you go! 🌟", "One little thing done 💛", "Proud of you! 🐾", "That's my human! 💞")
    val allDone = "Everything done today?! Best human ever 🎉"
    val waterGoal = "Water goal reached! Party time 🎉"
    val boop = listOf("Boop! 👃", "Mrrp? 😳", "Hehe, my nose 👃")
    val pet = listOf("Purrrr… 💕", "More scritches please 😽", "Right there! 💞")
    val thirsty = "I'm a bit thirsty… are you? 🥺"
    val sleeping = "Zzz… (it's quiet hours) 🌙"

    fun greeting(hour: Int, name: String): String = when (hour) {
        in 5..11 -> "Good morning! Ready for a sip? ☀️"
        in 12..17 -> "Hi! $name missed you 🐾"
        in 18..22 -> "Cozy evening! A cup of water? 🌙"
        else -> "Up late? Here's to a little sip 💧"
    }
}
