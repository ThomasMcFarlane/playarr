package io.playarr.shared.data.events

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.launchIn
import kotlinx.coroutines.flow.onEach
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.atomic.AtomicInteger

class LiveEventsManagerTest {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

    @After
    fun tearDown() = scope.cancel()

    /** A session whose frames and state changes the test drives by hand. */
    private class FakeSession : LiveEventsSession {
        override var lastEventId: Long? = null
        val runs = AtomicInteger()
        val cancelled = AtomicInteger()
        val resets = AtomicInteger()
        @Volatile var onState: ((LiveConnectionState) -> Unit)? = null
        @Volatile var onEvent: ((LiveEvent) -> Unit)? = null
        @Volatile var returnImmediately = false
        override fun resetCursor() { resets.incrementAndGet(); lastEventId = null }
        override suspend fun run(onState: (LiveConnectionState) -> Unit, onEvent: (LiveEvent) -> Unit) {
            runs.incrementAndGet()
            this.onState = onState
            this.onEvent = onEvent
            onState(LiveConnectionState.Connecting)
            if (returnImmediately) { onState(LiveConnectionState.Unsupported); return }
            try {
                CompletableDeferred<Unit>().await()
            } catch (e: kotlinx.coroutines.CancellationException) {
                cancelled.incrementAndGet()
                throw e
            }
        }
    }

    private class Harness(scope: CoroutineScope, val session: FakeSession = FakeSession(), pollMs: Long = 40, coalesceMs: Long = 30) {
        var mono = 0L
        var wall = 1_000_000L
        val bus = LiveInvalidationBus(wallClock = { wall })
        val manager = LiveEventsManager(scope, session, bus, pollMs, coalesceMs, monotonicMs = { mono }, wallClockMs = { wall })
        val received = CopyOnWriteArrayList<Invalidation>()
        init { bus.invalidations.onEach { received += it }.launchIn(scope) }
        fun change(type: String, entity: String, id: String?, changed: String, at: Long = wall) =
            session.onEvent!!(LiveEvent.Change(1, type, entity, id, listOf(changed), at))
        fun ready(retentionMs: Long = 600_000, serverTime: Long = wall) =
            session.onEvent!!(LiveEvent.Ready(1, retentionMs, 15_000, 300_000, serverTime))
    }

    private suspend fun until(timeoutMs: Long = 3_000, check: () -> Boolean) {
        withTimeout(timeoutMs) { while (!check()) delay(5) }
    }

    @Test
    fun `subscribes only while foregrounded and signed in`() = runBlocking {
        val h = Harness(scope)
        h.manager.setForeground(true)
        delay(60)
        assertEquals(0, h.session.runs.get())
        h.manager.setSession("srv|u1")
        until { h.session.runs.get() == 1 }
        h.manager.setForeground(false)
        until { h.session.cancelled.get() == 1 }
        assertEquals(LiveConnectionState.Idle, h.manager.state.value)
        h.manager.setForeground(true)
        until { h.session.runs.get() == 2 }
        h.manager.setSession(null)
        until { h.session.cancelled.get() == 2 }
        h.manager.setForeground(false)
        h.manager.setForeground(true)
        delay(60)
        assertEquals(2, h.session.runs.get())
    }

    @Test
    fun `pause keeps the cursor for resume but sign in as someone else drops it`() = runBlocking {
        val h = Harness(scope)
        h.manager.setSession("srv|u1")
        h.manager.setForeground(true)
        until { h.session.runs.get() == 1 }
        val resetsAfterSignIn = h.session.resets.get()
        h.session.lastEventId = 42
        h.manager.setForeground(false)
        h.manager.setForeground(true)
        until { h.session.runs.get() == 2 }
        assertEquals(42L, h.session.lastEventId)
        assertEquals(resetsAfterSignIn, h.session.resets.get())
        h.manager.setSession("srv|u2")
        until { h.session.runs.get() == 3 }
        assertEquals(null, h.session.lastEventId)
    }

    @Test
    fun `background longer than retention invalidates everything on resume, shorter does not`() = runBlocking {
        val h = Harness(scope)
        h.manager.setSession("s")
        h.manager.setForeground(true)
        until { h.session.runs.get() == 1 }
        h.ready(retentionMs = 10 * 60_000)
        // Short background (9 minutes): resume quietly.
        h.manager.setForeground(false)
        h.mono += 9 * 60_000
        h.manager.setForeground(true)
        until { h.session.runs.get() == 2 }
        delay(60)
        assertTrue(h.received.isEmpty())
        // Long background (11 minutes): everything is invalidated immediately.
        h.manager.setForeground(false)
        h.mono += 11 * 60_000
        h.manager.setForeground(true)
        until { h.received.any { it.everything } }
    }

    @Test
    fun `resync frame invalidates everything`() = runBlocking {
        val h = Harness(scope)
        h.manager.setSession("s"); h.manager.setForeground(true)
        until { h.session.runs.get() == 1 }
        h.session.onEvent!!(LiveEvent.Resync(9, "cursor_too_old"))
        until { h.received.any { it.everything } }
    }

    @Test
    fun `reconnect after a gap longer than retention refetches once, a short gap does not`() = runBlocking {
        val h = Harness(scope)
        h.manager.setSession("s"); h.manager.setForeground(true)
        until { h.session.runs.get() == 1 }
        h.ready(retentionMs = 60_000)
        h.session.onState!!(LiveConnectionState.Reconnecting)
        h.mono += 10_000
        h.session.onState!!(LiveConnectionState.Connected)
        h.ready(retentionMs = 60_000)
        delay(100)
        assertTrue(h.received.none { it.everything })
        h.session.onState!!(LiveConnectionState.Reconnecting)
        h.mono += 90_000
        h.session.onState!!(LiveConnectionState.Connected)
        h.ready(retentionMs = 60_000)
        until { h.received.count { it.everything } == 1 }
    }

    @Test
    fun `bursts are coalesced into one invalidation with all targets`() = runBlocking {
        val h = Harness(scope, coalesceMs = 80)
        h.manager.setSession("s"); h.manager.setForeground(true)
        until { h.session.runs.get() == 1 }
        h.ready()
        repeat(5) { i -> h.change("watch", "work", "w$i", "progress"); delay(10) }
        h.change("playlist", "playlist", "P", "items")
        until { h.received.isNotEmpty() }
        delay(200)
        assertEquals(1, h.received.size)
        val inv = h.received.single()
        assertTrue(inv.affects(setOf(LiveTarget(LiveArea.Work, "w3"))))
        assertTrue(inv.affects(setOf(LiveTarget(LiveArea.Playlist, "P"))))
        assertFalse(inv.affects(setOf(LiveTarget(LiveArea.Work, "other"))))
    }

    @Test
    fun `server time is converted to local time so own echoes can be dropped`() = runBlocking {
        val h = Harness(scope)
        h.manager.setSession("s"); h.manager.setForeground(true)
        until { h.session.runs.get() == 1 }
        // Server clock is 5 s ahead of the device.
        h.ready(serverTime = h.wall + 5_000)
        h.change("watch", "work", "A", "progress", at = h.wall + 5_000 + 100)
        until { h.received.isNotEmpty() }
        assertEquals(h.wall + 100, h.received.single().atLocalMs)
    }

    @Test
    fun `fallback polling runs only while the stream is down or unsupported`() = runBlocking {
        val h = Harness(scope, pollMs = 40)
        h.manager.setSession("s"); h.manager.setForeground(true)
        until { h.session.runs.get() == 1 }
        h.session.onState!!(LiveConnectionState.Connected)
        delay(150)
        assertTrue("no polling while healthy", h.received.none { it.poll })
        assertFalse(h.manager.polling.value)

        h.session.onState!!(LiveConnectionState.Reconnecting)
        // Backoff attempts flip through Connecting; the poll timer must survive that.
        until { h.received.count { it.poll } >= 2 }
        h.session.onState!!(LiveConnectionState.Connecting)
        assertTrue(h.manager.polling.value)

        h.session.onState!!(LiveConnectionState.Connected)
        until { !h.manager.polling.value }
        val before = h.received.count { it.poll }
        delay(150)
        assertEquals(before, h.received.count { it.poll })
    }

    @Test
    fun `unsupported server polls and is retried only after the next foreground`() = runBlocking {
        val session = FakeSession().apply { returnImmediately = true }
        val h = Harness(scope, session, pollMs = 30)
        h.manager.setSession("s"); h.manager.setForeground(true)
        until { h.received.count { it.poll } >= 2 }
        assertEquals(LiveConnectionState.Unsupported, h.manager.state.value)
        assertEquals(1, session.runs.get())
        h.manager.setForeground(false)
        assertFalse(h.manager.polling.value)
        h.manager.setForeground(true)
        until { session.runs.get() == 2 }
    }

    @Test
    fun `no polling or stream in the background`() = runBlocking {
        val session = FakeSession().apply { returnImmediately = true }
        val h = Harness(scope, session, pollMs = 20)
        h.manager.setSession("s")
        delay(100)
        assertTrue(h.received.isEmpty())
        assertEquals(0, session.runs.get())
    }
}
