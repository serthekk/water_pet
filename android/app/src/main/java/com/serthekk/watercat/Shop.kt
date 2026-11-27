package com.serthekk.watercat

import java.security.MessageDigest

/*
 * Growth, the catalog and the daily shop, as plain functions (ShopTest).
 *
 * Growth: she grows as your days together AND your friendship grow (both, so neither
 * waiting nor grinding alone is enough). Some items wait for a stage.
 *
 * Catalog (bought with 🐟 treats, then in the Bag):
 *   Clothes = the desktop's accessories (worn by the synced cat, so they show on the computer
 *             too; the desktop's streak unlockables stay earned there, not sold here)
 *   Body    = coats (the desktop's coat presets)
 *   House   = sleeping spots (cat tree, box) + garden decorations in her scene
 * The shop shows six items a day, the same six all day, never ones she already owns.
 */
object Growth {
    data class Stage(val index: Int, val name: String, val icon: String, val minDays: Int, val minSips: Int, val size: Float)

    val STAGES = listOf(
        Stage(0, "Kitten", "🌱", 0, 0, 0.72f),
        Stage(1, "Young cat", "🌿", 7, 150, 0.84f),
        Stage(2, "Grown cat", "🌳", 21, 500, 0.95f),
        Stage(3, "Wise cat", "✨", 60, 1500, 1f),
    )

    fun stage(ageDays: Int, totalSips: Int): Stage = STAGES.last { ageDays >= it.minDays && totalSips >= it.minSips }

    /** What the next stage still needs ("4 more days", "120 more sips"), or null at the top. */
    fun nextNeeds(ageDays: Int, totalSips: Int): String? {
        val next = STAGES.getOrNull(stage(ageDays, totalSips).index + 1) ?: return null
        val parts = listOfNotNull(
            (next.minDays - ageDays).takeIf { it > 0 }?.let { "$it more day${if (it == 1) "" else "s"}" },
            (next.minSips - totalSips).takeIf { it > 0 }?.let { "$it more sips" },
        )
        return "${next.icon} ${next.name} in ${parts.joinToString(" and ")}"
    }
}

object Catalog {
    enum class Tab(val label: String) { Clothes("Clothes"), Body("Body"), House("House") }

    /** kind: "acc" (accessory id), "coat" (preset id), "spot" (sleeping spot), "decor" (scene). */
    data class Item(val id: String, val tab: Tab, val kind: String, val ref: String, val label: String, val icon: String, val price: Int, val minStage: Int = 0)

    val DECOR = listOf("plant" to ("Potted plant" to "🪴"), "lights" to ("Fairy lights" to "✨"), "feeder" to ("Bird feeder" to "🐦"), "pond" to ("Little pond" to "🦆"))

    private val ACC = listOf(
        Triple("bow", "🎀", 12), Triple("bell", "🔔", 14), Triple("bandana", "🧣", 16), Triple("scarf", "🧶", 18),
        Triple("nametag", "🏷️", 18), Triple("glasses", "👓", 22), Triple("sunglasses", "🕶️", 28), Triple("crown", "👑", 45),
    )
    private val ACC_STAGE = mapOf("sunglasses" to 1, "crown" to 2)
    private val COAT_STAGE = mapOf("mainecoon" to 1, "persian" to 1, "ragdoll" to 2, "siamese" to 2)

    /** Everything that can be bought. Labels of clothes / coats come from the desktop data. */
    fun all(sprites: SpriteData): List<Item> {
        val clothes = ACC.filter { sprites.accessories[it.first]?.unlock == false }.map { (id, icon, price) ->
            Item("acc:$id", Tab.Clothes, "acc", id, sprites.accessories.getValue(id).label, icon, price, ACC_STAGE[id] ?: 0)
        }
        val coats = sprites.presets.values.filter { !it.unlock && it.id != "gargorl" }.map { p ->
            Item("coat:${p.id}", Tab.Body, "coat", p.id, p.label, "🎨", 35 + (COAT_STAGE[p.id] ?: 0) * 15, COAT_STAGE[p.id] ?: 0)
        }
        val house = listOf(
            Item("spot:tree", Tab.House, "spot", "tree", "Cat tree", "🌳", 40, 1),
            Item("spot:box", Tab.House, "spot", "box", "Cardboard box", "📦", 15),
        ) + DECOR.mapIndexed { i, (id, l) -> Item("decor:$id", Tab.House, "decor", id, l.first, l.second, listOf(20, 30, 25, 45)[i], if (id == "pond") 2 else 0) }
        return clothes + coats + house
    }

    /** Free from the start: her bed, the default coat (Gargorl's) and whatever she already wears / is. */
    fun ownedFree(cat: CatProfile): Set<String> = buildSet {
        add("spot:bed"); add("spot:none"); add("spot:random")
        add("coat:gargorl"); add("coat:${cat.preset}")
        cat.worn().filter { it.value.on }.keys.forEach { add("acc:$it") }
        if (cat.sleepSpot in setOf("tree", "box")) add("spot:${cat.sleepSpot}")
    }

    private fun seed(s: String) = MessageDigest.getInstance("SHA-256").digest(s.toByteArray()).let { b -> (0 until 8).fold(0L) { a, i -> (a shl 8) or (b[i].toLong() and 255) } }

    /** Today's six (the same all day; nothing she owns; at least one per tab when possible). */
    fun todaysShop(all: List<Item>, owned: Set<String>, date: String, count: Int = 6): List<Item> {
        val left = all.filter { it.id !in owned }
        val rnd = java.util.Random(seed("shop:$date"))
        val shuffled = left.shuffled(rnd)
        val pick = LinkedHashSet<Item>()
        for (tab in Tab.entries) shuffled.firstOrNull { it.tab == tab }?.let { pick += it }
        for (i in shuffled) { if (pick.size >= count) break; pick += i }
        return pick.take(count).sortedWith(compareBy({ it.tab.ordinal }, { it.price }))
    }

    /** Milliseconds until midnight (when the shop changes). */
    fun msToRefresh(now: java.util.Calendar): Long {
        val next = (now.clone() as java.util.Calendar).apply {
            add(java.util.Calendar.DAY_OF_MONTH, 1); set(java.util.Calendar.HOUR_OF_DAY, 0); set(java.util.Calendar.MINUTE, 0)
            set(java.util.Calendar.SECOND, 0); set(java.util.Calendar.MILLISECOND, 0)
        }
        return next.timeInMillis - now.timeInMillis
    }

    sealed class CanBuy {
        data object Yes : CanBuy()
        data object Owned : CanBuy()
        data class Locked(val stage: Growth.Stage) : CanBuy()
        data class NeedTreats(val more: Int) : CanBuy()
    }

    fun canBuy(item: Item, owned: Set<String>, stage: Growth.Stage, treats: Int): CanBuy = when {
        item.id in owned -> CanBuy.Owned
        stage.index < item.minStage -> CanBuy.Locked(Growth.STAGES[item.minStage])
        treats < item.price -> CanBuy.NeedTreats(item.price - treats)
        else -> CanBuy.Yes
    }
}
