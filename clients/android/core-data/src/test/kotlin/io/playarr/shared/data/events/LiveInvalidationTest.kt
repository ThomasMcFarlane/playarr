package io.playarr.shared.data.events

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class LiveInvalidationTest {
    private fun change(type: String, entity: String, id: String?, vararg changed: String, at: Long = 1) =
        LiveEvent.Change(1, type, entity, id, changed.toList(), at)

    private val workA = setOf(LiveTarget(LiveArea.Work, "A"))
    private val workB = setOf(LiveTarget(LiveArea.Work, "B"))

    @Test
    fun `watch event for work A invalidates A and progress but not B`() {
        val inv = Invalidation(LiveEventMapper.targetsFor(change("watch", "work", "A", "progress"))!!)
        assertTrue(inv.affects(workA))
        assertFalse(inv.affects(workB))
        assertTrue(inv.affects(setOf(LiveTarget(LiveArea.Progress))))
        assertTrue(inv.affects(setOf(LiveTarget(LiveArea.Home))))
        assertFalse(inv.affects(setOf(LiveTarget(LiveArea.Calendar), LiveTarget(LiveArea.Watchlist), LiveTarget(LiveArea.Playlist))))
    }

    @Test
    fun `library files event for work A hits detail, lists, home and search only`() {
        val inv = Invalidation(LiveEventMapper.targetsFor(change("library", "work", "A", "files"))!!)
        assertTrue(inv.affects(workA))
        assertFalse(inv.affects(workB))
        for (area in listOf(LiveArea.Library, LiveArea.Home, LiveArea.Search)) assertTrue(inv.affects(setOf(LiveTarget(area))))
        for (area in listOf(LiveArea.Calendar, LiveArea.Progress, LiveArea.Watchlist, LiveArea.Household)) {
            assertFalse(area.name, inv.affects(setOf(LiveTarget(area))))
        }
    }

    @Test
    fun `bulk library event invalidates every work and all catalogue derived areas`() {
        val inv = Invalidation(LiveEventMapper.targetsFor(change("library", "*", null, "bulk"))!!)
        assertTrue(inv.affects(workA))
        assertTrue(inv.affects(workB))
        for (area in listOf(LiveArea.Library, LiveArea.Home, LiveArea.Search, LiveArea.Calendar, LiveArea.Playlist)) {
            assertTrue(area.name, inv.affects(setOf(LiveTarget(area))))
        }
        assertFalse(inv.affects(setOf(LiveTarget(LiveArea.Watchlist))))
    }

    @Test
    fun `other event types map to their own area`() {
        fun areas(e: LiveEvent.Change) = LiveEventMapper.targetsFor(e)!!.map { it.area }.toSet()
        assertEquals(setOf(LiveArea.Calendar), areas(change("calendar", "work", "A", "imported")))
        assertEquals(setOf(LiveArea.Watchlist), areas(change("watchlist", "watchlist", "tt1", "added")))
        assertEquals(setOf(LiveArea.Downloads), areas(change("download", "download", "d1", "status")))
        assertEquals(setOf(LiveArea.Household), areas(change("household", "profile", "p1", "status")))
        assertEquals(setOf(LiveArea.Admin), areas(change("admin", "source_instance", "s1", "sync_finished")))
        assertTrue(LiveArea.Account in areas(change("account", "profile", "u1", "policy")))
        assertNull(LiveEventMapper.targetsFor(change("future-type", "x", null)))
    }

    @Test
    fun `playlist event only touches its own detail but every playlist list`() {
        val inv = Invalidation(LiveEventMapper.targetsFor(change("playlist", "playlist", "P1", "items"))!!)
        assertTrue(inv.affects(setOf(LiveTarget(LiveArea.Playlist, "P1"))))
        assertFalse(inv.affects(setOf(LiveTarget(LiveArea.Playlist, "P2"))))
        assertTrue(inv.affects(setOf(LiveTarget(LiveArea.Playlist))))
    }

    @Test
    fun `events not newer than the data already fetched are dropped`() {
        val inv = Invalidation(workA, atLocalMs = 1_000)
        assertFalse(inv.requiresRefetch(workA, fetchStartedMs = 1_000))
        assertFalse(inv.requiresRefetch(workA, fetchStartedMs = 2_000))
        assertTrue(inv.requiresRefetch(workA, fetchStartedMs = 999))
        assertTrue(Invalidation(workA, atLocalMs = null).requiresRefetch(workA, fetchStartedMs = Long.MAX_VALUE))
        assertTrue(Invalidation(everything = true, atLocalMs = 5).requiresRefetch(workB, 0))
    }

    @Test
    fun `merge keeps the union and the newest timestamp, unknown time wins`() {
        val merged = Invalidation(workA, atLocalMs = 10).merge(Invalidation(workB, atLocalMs = 20))
        assertEquals(workA + workB, merged.targets)
        assertEquals(20L, merged.atLocalMs)
        assertNull(merged.merge(Invalidation(poll = true)).atLocalMs)
    }

    @Test
    fun `bus tracks staleness for consumers that were hidden`() {
        val bus = LiveInvalidationBus(wallClock = { 500 })
        bus.publish(Invalidation(workA, atLocalMs = 1_000))
        assertTrue(bus.isStale(workA, fetchStartedMs = 900))
        assertFalse(bus.isStale(workA, fetchStartedMs = 1_000))
        assertFalse(bus.isStale(workB, fetchStartedMs = 0))
        bus.publish(Invalidation(everything = true, atLocalMs = 3_000))
        assertTrue(bus.isStale(workB, fetchStartedMs = 2_000))
        assertEquals(3_000L, bus.lastInvalidatedAtMs(workB))
    }
}
