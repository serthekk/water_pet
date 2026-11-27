package com.serthekk.watercat

import kotlin.math.abs

/*
 * Adventures, as plain functions (AdventuresTest). Once today's energy bar is full she can
 * go out exploring the garden, once a day, for [TRIP_MS]. The trip is stored (start + return
 * time), so the countdown keeps going with the app closed. When she is back she brings a
 * little story, some 🐟 treats and a souvenir for her bag; welcoming her home claims them.
 */
object Adventures {
    const val TRIP_MS = 3 * 60 * 60 * 1000L // three hours out in the garden

    /** Something she found (goes in the bag as "souvenir:<id>"). */
    data class Souvenir(val id: String, val label: String, val icon: String)

    data class Story(val id: Int, val place: String, val text: String, val souvenir: Souvenir)

    private val S = mapOf(
        "pebble" to Souvenir("pebble", "Shiny pebble", "🪨"), "feather" to Souvenir("feather", "Bird feather", "🪶"),
        "clover" to Souvenir("clover", "Four-leaf clover", "🍀"), "button" to Souvenir("button", "Lost button", "🔘"),
        "acorn" to Souvenir("acorn", "Acorn", "🌰"), "shell" to Souvenir("shell", "Snail shell", "🐚"),
        "pinecone" to Souvenir("pinecone", "Pinecone", "🌲"), "daisy" to Souvenir("daisy", "Daisy", "🌼"),
        "key" to Souvenir("key", "Mystery key", "🗝️"), "marble" to Souvenir("marble", "Blue marble", "🔵"),
        "leaf" to Souvenir("leaf", "Golden leaf", "🍂"), "string" to Souvenir("string", "Bit of string", "🧵"),
    )

    /** Her stories ({name} = her name, {they}/{their} = her pronouns). */
    val STORIES: List<Story> = listOf(
        Story(0, "the old fence", "{name} followed a butterfly all the way to the old fence and found something sparkly in the grass.", S.getValue("pebble")),
        Story(1, "the bird bath", "{name} sat very still by the bird bath for an hour. No birds were caught, but a feather was.", S.getValue("feather")),
        Story(2, "the clover patch", "{name} rolled around in the clover patch and came back with a lucky souvenir stuck to {their} fur.", S.getValue("clover")),
        Story(3, "under the porch", "{name} explored under the porch, sneezed twice, and brought back a button nobody missed.", S.getValue("button")),
        Story(4, "the big oak", "A squirrel dropped something on {name}'s head under the big oak. {They} kept it, obviously.", S.getValue("acorn")),
        Story(5, "the flower bed", "{name} made friends with a very slow snail in the flower bed. It gave {them} its old house.", S.getValue("shell")),
        Story(6, "the hedge maze", "{name} got lost in the hedge for a while (on purpose) and found a pinecone at the end.", S.getValue("pinecone")),
        Story(7, "the sunny steps", "{name} napped on the sunny steps, then picked the prettiest flower for you.", S.getValue("daisy")),
        Story(8, "the garden shed", "{name} peeked into the garden shed and came back with a tiny key. What does it open?", S.getValue("key")),
        Story(9, "the puddle", "{name} inspected a puddle from every angle and fished out a marble.", S.getValue("marble")),
        Story(10, "the leaf pile", "{name} jumped into the leaf pile seven times. The best leaf came home.", S.getValue("leaf")),
        Story(11, "the washing line", "{name} wrestled the washing line and won a bit of string. A great victory.", S.getValue("string")),
        Story(12, "the vegetable patch", "{name} guarded the vegetable patch from a very suspicious beetle. Here is {their} reward.", S.getValue("clover")),
        Story(13, "the garden wall", "{name} walked the whole garden wall like a tightrope and found something at the end.", S.getValue("pebble")),
    )

    /** A story she hasn't told recently (seeded, so the same trip always has the same story). */
    fun pickStory(seed: Long, recent: List<Int>): Story {
        val fresh = STORIES.filter { it.id !in recent.takeLast(6) }.ifEmpty { STORIES }
        return fresh[abs((seed xor (seed ushr 17)) % fresh.size).toInt()]
    }

    fun treatsFor(seed: Long): Int = 8 + abs((seed * 31 + 7) % 8).toInt() // 8..15 🐟

    fun tell(story: Story, name: String, gender: String): String {
        val (they, them, their) = PetStats.pronounWords(gender)
        return story.text.replace("{name}", name).replace("{They}", they.replaceFirstChar { it.uppercase() }).replace("{they}", they)
            .replace("{them}", them).replace("{their}", their)
    }

    /** Where today's adventure stands. */
    sealed class Status {
        data object NotEnoughEnergy : Status()
        data object Ready : Status() // the bar is full: she can go
        data class Away(val remainingMs: Long, val progress: Float) : Status()
        data object Back : Status() // home, waiting to be welcomed
        data object DoneToday : Status()
    }

    /** startedAt / returnsAt / claimed of today's trip (null = none yet). */
    data class Trip(val id: Long, val date: String, val startedAt: Long, val returnsAt: Long, val storyId: Int, val treats: Int, val claimed: Boolean)

    fun status(sipsToday: Int, today: String, trip: Trip?, now: Long): Status = when {
        trip != null && !trip.claimed && now < trip.returnsAt ->
            Status.Away(trip.returnsAt - now, ((now - trip.startedAt).toFloat() / (trip.returnsAt - trip.startedAt)).coerceIn(0f, 1f))
        trip != null && !trip.claimed -> Status.Back // also a trip from yesterday that was never welcomed
        trip != null && trip.date == today -> Status.DoneToday
        sipsToday >= GameRules.ADVENTURE_SIPS -> Status.Ready
        else -> Status.NotEnoughEnergy
    }

    /** "2:41:09" (hours not padded, like a countdown). */
    fun countdown(ms: Long): String {
        val s = (ms.coerceAtLeast(0) + 999) / 1000
        return "%d:%02d:%02d".format(s / 3600, (s / 60) % 60, s % 60)
    }

    fun reward(trip: Trip) = Reward("adventure:${trip.id}", trip.date, 0, trip.treats, "Adventure")
}
