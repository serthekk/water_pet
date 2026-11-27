package com.serthekk.watercat

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.util.Calendar

class ShopTest {
    private val sprites = SpriteData(JSONObject(File("src/main/assets/catsprite.json").readText()))
    private val all = Catalog.all(sprites)

    @Test fun growthNeedsDaysAndFriendship() {
        assertEquals("Kitten", Growth.stage(1, 0).name)
        assertEquals("Kitten", Growth.stage(30, 100).name) // waiting alone isn't enough
        assertEquals("Kitten", Growth.stage(3, 5000).name) // nor grinding alone
        assertEquals("Young cat", Growth.stage(7, 150).name)
        assertEquals("Grown cat", Growth.stage(21, 500).name)
        assertEquals("Wise cat", Growth.stage(365, 99_999).name)
        assertEquals("🌿 Young cat in 2 more days and 50 more sips", Growth.nextNeeds(5, 100))
        assertEquals("🌿 Young cat in 1 more day", Growth.nextNeeds(6, 200))
        assertNull(Growth.nextNeeds(60, 1500))
        assertTrue(Growth.STAGES.zipWithNext().all { (a, b) -> a.size < b.size })
    }

    @Test fun catalogHasEveryTabAndNoDesktopUnlockables() {
        assertTrue(Catalog.Tab.entries.all { t -> all.any { it.tab == t } })
        assertEquals(all.size, all.map { it.id }.toSet().size)
        assertTrue(all.none { it.ref in setOf("heartglasses", "flowercrown", "goldcrown", "rainbow", "galaxy") })
        assertTrue(all.none { it.id == "coat:gargorl" }) // her default coat is free
        assertTrue(all.all { it.price > 0 })
        assertTrue(all.filter { it.kind == "acc" }.all { sprites.accessories.containsKey(it.ref) })
        assertTrue(all.filter { it.kind == "coat" }.all { sprites.presets.containsKey(it.ref) })
    }

    @Test fun theDailyShopIsStableFairAndSkipsOwnedItems() {
        val a = Catalog.todaysShop(all, emptySet(), "2026-11-27")
        assertEquals(6, a.size)
        assertEquals(a, Catalog.todaysShop(all, emptySet(), "2026-11-27")) // the same all day
        assertNotEquals(a, Catalog.todaysShop(all, emptySet(), "2026-11-28")) // new tomorrow
        assertTrue(Catalog.Tab.entries.all { t -> a.any { it.tab == t } })
        val owned = a.take(3).map { it.id }.toSet()
        assertTrue(Catalog.todaysShop(all, owned, "2026-11-27").none { it.id in owned })
        assertTrue(Catalog.todaysShop(all, all.map { it.id }.toSet(), "2026-11-27").isEmpty()) // owns it all
    }

    @Test fun buyingRules() {
        val crown = all.first { it.ref == "crown" }
        val bow = all.first { it.ref == "bow" }
        val kitten = Growth.STAGES[0]
        assertEquals(Catalog.CanBuy.Locked(Growth.STAGES[2]), Catalog.canBuy(crown, emptySet(), kitten, 999))
        assertEquals(Catalog.CanBuy.NeedTreats(2), Catalog.canBuy(bow, emptySet(), kitten, 10))
        assertEquals(Catalog.CanBuy.Yes, Catalog.canBuy(bow, emptySet(), kitten, 12))
        assertEquals(Catalog.CanBuy.Owned, Catalog.canBuy(bow, setOf(bow.id), kitten, 0))
    }

    @Test fun freeThingsAndRefreshTime() {
        val cat = CatProfile.default(sprites).wearing("bow", true).withSleepSpot("box")
        val free = Catalog.ownedFree(cat)
        assertTrue(setOf("spot:bed", "coat:gargorl", "acc:bow", "spot:box").all { it in free })
        val c = Calendar.getInstance().apply { set(2026, 10, 27, 23, 0, 0); set(Calendar.MILLISECOND, 0) }
        assertEquals(3_600_000L, Catalog.msToRefresh(c))
    }
}
