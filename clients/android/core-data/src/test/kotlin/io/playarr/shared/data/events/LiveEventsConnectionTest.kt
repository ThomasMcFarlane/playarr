package io.playarr.shared.data.events

import io.playarr.shared.data.model.ClientPlatform
import io.playarr.shared.data.remote.PlayarrHttpClient
import java.io.IOException
import java.io.StringReader
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.async
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class LiveEventsConnectionTest {
    private fun sse(vararg frames: String) = frames.joinToString("") { "$it\n\n" }
    private val readyFrame = "id: 3\nevent: ready\ndata: {\"seq\":3,\"retention_ms\":600000,\"heartbeat_ms\":15000,\"max_age_ms\":300000,\"server_time_ms\":10}"
    private fun changeFrame(seq: Long) = "id: $seq\nevent: change\ndata: {\"seq\":$seq,\"type\":\"watch\",\"entity\":\"work\",\"id\":\"w$seq\",\"changed\":[\"progress\"],\"at\":$seq}"

    private fun ok(body: String) = LiveEventsResponse(200, "text/event-stream; charset=utf-8", StringReader(body)) {}
    private fun bad(code: Int, type: String?) = LiveEventsResponse(code, type, null) {}

    /** Scripted transport; records the cursor each open was given. */
    private class Script(private val steps: MutableList<() -> LiveEventsResponse>) : LiveEventsTransport {
        val cursors = mutableListOf<Long?>()
        override suspend fun open(lastEventId: Long?): LiveEventsResponse {
            cursors += lastEventId
            return steps.removeAt(0)()
        }
    }

    private class Recorder {
        val states = mutableListOf<LiveConnectionState>()
        val events = mutableListOf<LiveEvent>()
    }

    @Test
    fun `html or 404 or non event stream 200 is unsupported and is not retried`() = runBlocking {
        for (response in listOf(bad(200, "text/html"), bad(404, "text/html"), bad(200, null), bad(404, null), bad(403, null))) {
            val script = Script(mutableListOf({ response }))
            val sleeps = mutableListOf<Long>()
            val recorder = Recorder()
            LiveEventsConnection(script, sleep = { sleeps += it }).run({ recorder.states += it }, { recorder.events += it })
            assertEquals(LiveConnectionState.Unsupported, recorder.states.last())
            assertEquals(1, script.cursors.size)
            assertTrue(sleeps.isEmpty())
        }
    }

    @Test
    fun `event stream content type with parameters and different case is accepted`() {
        assertTrue(isEventStream(200, "text/event-stream"))
        assertTrue(isEventStream(200, "Text/Event-Stream; charset=utf-8"))
        assertFalse(isEventStream(200, "text/html"))
        assertFalse(isEventStream(204, "text/event-stream"))
        assertFalse(isEventStream(200, null))
    }

    @Test
    fun `transient statuses and io errors retry with backoff while unsupported does not`() = runBlocking {
        val sleeps = mutableListOf<Long>()
        val script = Script(
            mutableListOf(
                { bad(503, "text/html") },
                { bad(401, null) },
                { throw IOException("boom") },
                { bad(404, "text/html") },
            ),
        )
        val recorder = Recorder()
        LiveEventsConnection(script, sleep = { sleeps += it }, random = { 1.0 }).run({ recorder.states += it }, { })
        assertEquals(listOf(1_000L, 2_000L, 4_000L), sleeps)
        assertEquals(LiveConnectionState.Unsupported, recorder.states.last())
        assertTrue(LiveConnectionState.Reconnecting in recorder.states)
    }

    @Test
    fun `backoff doubles to a thirty second cap with jitter inside the cap`() {
        assertEquals(listOf(1_000L, 2_000L, 4_000L, 8_000L, 16_000L, 30_000L, 30_000L), (1..7).map { LiveBackoff.delayMs(it, 1.0) })
        assertEquals(750L, LiveBackoff.delayMs(1, 0.0))
        assertEquals(22_500L, LiveBackoff.delayMs(9, 0.0))
        for (attempt in 1..40) {
            val d = LiveBackoff.delayMs(attempt, 0.999)
            assertTrue(d in 750L..30_000L)
        }
    }

    @Test
    fun `a stream that stays up for a minute resets the backoff and a server close reconnects at once`() = runBlocking {
        var now = 0L
        val sleeps = mutableListOf<Long>()
        val recorder = Recorder()
        val slowEnd = {
            // Stream stays open 5 minutes (the server's own close), then ends cleanly.
            LiveEventsResponse(200, "text/event-stream", object : java.io.Reader() {
                private var sent = false
                override fun read(cbuf: CharArray, off: Int, len: Int): Int {
                    if (sent) return -1
                    sent = true
                    now += 300_000
                    val text = sse(readyFrame)
                    text.toCharArray(cbuf, off, 0, text.length)
                    return text.length
                }
                override fun close() {}
            }) {}
        }
        val script = Script(
            mutableListOf(
                { bad(500, null) },
                { bad(500, null) },
                slowEnd,
                { bad(404, null) },
            ),
        )
        LiveEventsConnection(script, clock = { now }, sleep = { sleeps += it }, random = { 1.0 })
            .run({ recorder.states += it }, { recorder.events += it })
        // Two failures back off 1 s then 2 s; the long stream reconnects with no sleep at all.
        assertEquals(listOf(1_000L, 2_000L), sleeps)
        assertEquals(4, script.cursors.size)
        assertEquals(listOf<Long?>(null, null, null, 3L), script.cursors)
    }

    @Test
    fun `after a stable stream a failure starts the backoff from one second again`() = runBlocking {
        var now = 0L
        val sleeps = mutableListOf<Long>()
        val failing = {
            LiveEventsResponse(200, "text/event-stream", object : java.io.Reader() {
                private var step = 0
                override fun read(cbuf: CharArray, off: Int, len: Int): Int {
                    step++
                    if (step == 1) {
                        now += 61_000
                        val t = sse(readyFrame)
                        t.toCharArray(cbuf, off, 0, t.length)
                        return t.length
                    }
                    throw IOException("reset")
                }
                override fun close() {}
            }) {}
        }
        val script = Script(mutableListOf({ bad(500, null) }, { bad(500, null) }, { bad(500, null) }, failing, { bad(404, null) }))
        LiveEventsConnection(script, clock = { now }, sleep = { sleeps += it }, random = { 1.0 }).run({ }, { })
        assertEquals(listOf(1_000L, 2_000L, 4_000L, 1_000L), sleeps)
    }

    @Test
    fun `last event id advances from ids and is sent on the next open`() = runBlocking {
        val script = Script(
            mutableListOf(
                { ok(sse(readyFrame, changeFrame(4), changeFrame(5))) },
                { bad(404, null) },
            ),
        )
        val recorder = Recorder()
        val connection = LiveEventsConnection(script, sleep = { }, clock = { 0L })
        connection.run({ recorder.states += it }, { recorder.events += it })
        assertEquals(listOf<Long?>(null, 5L), script.cursors)
        assertEquals(5L, connection.lastEventId)
        assertEquals(3, recorder.events.size)
        assertTrue(recorder.events[0] is LiveEvent.Ready)
        connection.resetCursor()
        assertNull(connection.lastEventId)
    }

    @Test
    fun `cancel pauses, keeps the cursor and reports idle`() = runBlocking {
        val gate = CompletableDeferred<Unit>()
        val script = Script(
            mutableListOf(
                {
                    LiveEventsResponse(200, "text/event-stream", object : java.io.Reader() {
                        private var first = true
                        override fun read(cbuf: CharArray, off: Int, len: Int): Int {
                            if (first) {
                                first = false
                                val t = sse(readyFrame, changeFrame(9))
                                t.toCharArray(cbuf, off, 0, t.length)
                                return t.length
                            }
                            // Blocks like a socket read until closed.
                            runBlocking { gate.await() }
                            throw IOException("closed")
                        }
                        override fun close() { gate.complete(Unit) }
                    }) { gate.complete(Unit) }
                },
            ),
        )
        val recorder = Recorder()
        val connection = LiveEventsConnection(script)
        val job = async(start = CoroutineStart.DEFAULT) { connection.run({ recorder.states += it }, { recorder.events += it }) }
        withTimeout(5_000) { while (recorder.events.size < 2) kotlinx.coroutines.delay(5) }
        job.cancelAndJoin()
        assertEquals(LiveConnectionState.Idle, recorder.states.last())
        assertEquals(9L, connection.lastEventId)
    }

    @Test
    fun `real http stream sends bearer and last event id, refreshes on 401 and detects html`() = runBlocking {
        val server = MockWebServer()
        server.enqueue(MockResponse().setResponseCode(401))
        server.enqueue(
            MockResponse().setResponseCode(200).setHeader("Content-Type", "text/event-stream")
                .setBody(sse(readyFrame, changeFrame(4))),
        )
        server.enqueue(MockResponse().setResponseCode(200).setHeader("Content-Type", "text/html").setBody("<html></html>"))
        server.start()
        try {
            var token = "old"
            val api = PlayarrHttpClient.createEvents(
                baseUrlProvider = { server.url("/").toString() },
                clientPlatform = ClientPlatform.AndroidTv,
                clientVersion = "1",
                accessTokenProvider = { token },
                refreshAccessToken = { token = "new"; token },
            )
            val recorder = Recorder()
            val connection = LiveEventsConnection(api.asTransport(), sleep = { }, clock = { 0L })
            connection.run({ recorder.states += it }, { recorder.events += it })
            assertEquals(LiveConnectionState.Unsupported, recorder.states.last())
            assertEquals(4L, connection.lastEventId)
            val first = server.takeRequest()
            assertEquals("Bearer old", first.headers["Authorization"])
            assertNull(first.headers["Last-Event-ID"])
            assertEquals("/api/v1/events", first.path?.substringBefore("?"))
            val second = server.takeRequest()
            assertEquals("Bearer new", second.headers["Authorization"])
            assertEquals("4", server.takeRequest().headers["Last-Event-ID"])
        } finally {
            server.close()
        }
    }
}
