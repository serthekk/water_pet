package com.serthekk.watercat

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** The "sync now" nudge from sync.js: `WATERCAT_HERE 1 <computer id> up|bye` (UDP 47825). */
class SyncNudgesTest {
    private val id = "0123456789abcdef"

    @Test fun ourComputer() {
        assertEquals("up", SyncNudges.parse("WATERCAT_HERE 1 $id up", id))
        assertEquals("bye", SyncNudges.parse("WATERCAT_HERE 1 $id bye\n", id))
    }

    @Test fun anotherComputerIsIgnored() {
        assertNull(SyncNudges.parse("WATERCAT_HERE 1 fedcba9876543210 up", id))
    }

    @Test fun junkIsIgnored() {
        assertNull(SyncNudges.parse("WATERCAT_DISCOVER 1", id))
        assertNull(SyncNudges.parse("WATERCAT_HERE 2 $id up", id))
        assertNull(SyncNudges.parse("WATERCAT_HERE 1 $id reboot", id))
        assertNull(SyncNudges.parse("WATERCAT_HERE 1 $id up extra", id))
        assertNull(SyncNudges.parse("WATERCAT_HERE 1 $id up" + " ".repeat(80) + "x", id))
        assertNull(SyncNudges.parse("", id))
    }

    @Test fun samePortAsTheDesktop() {
        // sync.js PHONE_PORT
        assertEquals(47825, SyncNudges.PORT)
    }
}
