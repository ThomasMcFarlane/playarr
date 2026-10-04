package io.playarr.mobile.remote

import io.playarr.shared.data.model.AckRemoteEventRequest
import io.playarr.shared.data.model.AckRemoteHandoffRequest
import io.playarr.shared.data.model.RegisterRemoteTargetRequest
import io.playarr.shared.data.model.RemoteInbox
import io.playarr.shared.data.model.RemoteInboxEvent
import io.playarr.shared.data.model.ReportRemoteStateRequest
import java.util.concurrent.CopyOnWriteArrayList
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class RemoteTargetHostTest {
    private class FakeApi : RemoteTargetApi {
        val acks = CopyOnWriteArrayList<Triple<String, String, String?>>()
        val handoffAcks = CopyOnWriteArrayList<Pair<String, AckRemoteHandoffRequest>>()
        val registered = CopyOnWriteArrayList<RegisterRemoteTargetRequest>()
        val states = CopyOnWriteArrayList<ReportRemoteStateRequest>()
        var inboxes: ArrayDeque<RemoteInbox> = ArrayDeque()
        val inboxCursors = CopyOnWriteArrayList<Long>()
        val streamCursors = CopyOnWriteArrayList<Long>()
        var streamSessions: ArrayDeque<List<RemoteInboxEvent>> = ArrayDeque()
        var streamFailure: Exception? = null
        override suspend fun stream(after: Long, onOpen: () -> Unit, onEvent: suspend (RemoteInboxEvent) -> Unit) {
            streamCursors += after
            streamFailure?.let { throw it }
            val session = streamSessions.removeFirstOrNull() ?: run {
                onOpen()
                kotlinx.coroutines.awaitCancellation()
            }
            onOpen()
            session.forEach { onEvent(it) }
        }
        override suspend fun register(request: RegisterRemoteTargetRequest) { registered += request }
        override suspend fun inbox(after: Long, wait: Int): RemoteInbox {
            inboxCursors += after
            return inboxes.removeFirstOrNull() ?: kotlinx.coroutines.awaitCancellation()
        }
        override suspend fun ackEvent(eventId: String, request: AckRemoteEventRequest) {
            acks += Triple(eventId, request.status, request.detail)
        }
        override suspend fun ackHandoff(handoffId: String, request: AckRemoteHandoffRequest) {
            handoffAcks += handoffId to request
        }
        override suspend fun reportState(request: ReportRemoteStateRequest) { states += request }
    }

    private class FakeHandlers : RemoteTargetHandlers {
        val pairings = mutableListOf<RemotePairingRequest>()
        val revoked = mutableListOf<String>()
        val stopped = mutableListOf<String>()
        val executed = mutableListOf<Pair<String, JsonObject>>()
        var outcome: RemoteOutcome = RemoteOutcome.Ok
        var offerResult: RemoteHandoffResult = RemoteHandoffResult.Playing(1_234L)
        var state: JsonElement? = buildJsonObject { put("position_ms", 1L) }
        val offers = CompletableDeferred<RemoteHandoffOffer>()
        override fun onPairingRequest(request: RemotePairingRequest) { pairings += request }
        override fun onPairingRevoked(pairingId: String) { revoked += pairingId }
        override suspend fun execute(kind: String, args: JsonObject): RemoteOutcome {
            executed += kind to args
            return outcome
        }
        override suspend fun onHandoffOffer(offer: RemoteHandoffOffer): RemoteHandoffResult {
            offers.complete(offer)
            return offerResult
        }
        override suspend fun onHandoffStop(handoffId: String) { stopped += handoffId }
        override fun currentState(): JsonElement? = state
    }

    private fun event(kind: String, payload: JsonObject, id: String = "e1", seq: Long = 1L) =
        RemoteInboxEvent(id = id, seq = seq, kind = kind, payload = payload)

    private fun host(api: FakeApi, handlers: FakeHandlers) =
        RemoteTargetHost(api, handlers, "TV", "android-tv", listOf("navigate"))

    @Test
    fun `pairing requests reach the prompt and are acknowledged`() = runBlocking {
        val api = FakeApi(); val handlers = FakeHandlers()
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
        host(api, handlers).handle(
            event("pairing_request", buildJsonObject {
                put("pairing_id", "p1"); put("controller_name", "Phone"); put("verification_code", "123456")
            }),
            scope,
        )
        assertEquals(listOf(RemotePairingRequest("p1", "Phone", "123456", emptyList())), handlers.pairings)
        assertEquals(listOf(Triple("e1", "ok", null)), api.acks.toList())
        scope.cancel()
    }

    @Test
    fun `commands are executed and acknowledged without leaking arguments`() = runBlocking {
        val api = FakeApi(); val handlers = FakeHandlers()
        handlers.outcome = RemoteOutcome.Failed("no text field is focused")
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
        host(api, handlers).handle(
            event("command", buildJsonObject {
                put("kind", "text")
                put("args", buildJsonObject { put("value", "hunter2") })
            }),
            scope,
        )
        assertEquals("text", handlers.executed.single().first)
        assertEquals(listOf(Triple("e1", "failed", "no text field is focused")), api.acks.toList())
        assertFalse(api.acks.toString().contains("hunter2"))
        scope.cancel()
    }

    @Test
    fun `a throwing handler is acknowledged as failed`() = runBlocking {
        val api = FakeApi()
        val handlers = object : RemoteTargetHandlers by FakeHandlers() {
            override suspend fun execute(kind: String, args: JsonObject): RemoteOutcome = error("boom")
        }
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
        RemoteTargetHost(api, handlers, "TV", "android-tv", listOf("navigate"))
            .handle(event("command", buildJsonObject { put("kind", "navigate") }), scope)
        assertEquals("failed", api.acks.single().second)
        scope.cancel()
    }

    @Test
    fun `handoff offers acknowledge the position actually started at`() = runBlocking {
        val api = FakeApi(); val handlers = FakeHandlers()
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
        host(api, handlers).handle(
            event("handoff_offer", buildJsonObject {
                put("handoff_id", "h1"); put("media_file_id", "m1")
                put("snapshot", buildJsonObject { put("position_ms", 1_000L); put("paused", false) })
            }),
            scope,
        )
        val offer = withTimeout(2_000) { handlers.offers.await() }
        assertEquals(1_000L, offer.positionMs)
        withTimeout(2_000) { while (api.handoffAcks.isEmpty()) kotlinx.coroutines.delay(10) }
        val (id, ack) = api.handoffAcks.single()
        assertEquals("h1", id)
        assertEquals("playing", ack.status)
        assertEquals(1_234L, ack.positionMs)
        scope.cancel()
    }

    @Test
    fun `a failed destination reports failure so the source keeps playing`() = runBlocking {
        val api = FakeApi(); val handlers = FakeHandlers()
        handlers.offerResult = RemoteHandoffResult.Failed("playback did not start in time")
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
        host(api, handlers).handle(
            event("handoff_offer", buildJsonObject { put("handoff_id", "h2"); put("media_file_id", "m1") }),
            scope,
        )
        withTimeout(2_000) { while (api.handoffAcks.isEmpty()) kotlinx.coroutines.delay(10) }
        assertEquals("failed", api.handoffAcks.single().second.status)
        assertEquals("playback did not start in time", api.handoffAcks.single().second.reason)
        scope.cancel()
    }

    @Test
    fun `stop events and malformed or unknown events are handled`() = runBlocking {
        val api = FakeApi(); val handlers = FakeHandlers()
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
        val host = host(api, handlers)
        host.handle(event("handoff_stop", buildJsonObject { put("handoff_id", "h1") }, "s"), scope)
        host.handle(event("handoff_offer", JsonObject(emptyMap()), "bad"), scope)
        host.handle(event("mystery", JsonObject(emptyMap()), "odd"), scope)
        assertEquals(listOf("h1"), handlers.stopped)
        assertEquals(
            listOf(Triple("s", "ok", null), Triple("bad", "failed", "malformed offer"), Triple("odd", "unsupported", "unknown event")),
            api.acks.toList(),
        )
        scope.cancel()
    }

    @Test
    fun `the loop registers once and polls from the last cursor`() = runBlocking {
        val api = FakeApi(); val handlers = FakeHandlers()
        api.streamFailure = PushUnsupportedException("no push")
        api.inboxes = ArrayDeque(
            listOf(RemoteInbox(listOf(event("handoff_stop", buildJsonObject { put("handoff_id", "h") })), next = 7L)),
        )
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
        val host = host(api, handlers)
        host.start(scope)
        withTimeout(3_000) { while (api.inboxCursors.size < 2) kotlinx.coroutines.delay(10) }
        host.stop()
        scope.cancel()
        assertEquals(1, api.registered.size)
        assertEquals(listOf(0L, 7L), api.inboxCursors.take(2))
        assertEquals(listOf("h"), handlers.stopped)
    }

    @Test
    fun `state is reported once while unchanged`() = runBlocking {
        val api = FakeApi(); val handlers = FakeHandlers()
        val host = host(api, handlers)
        host.reportState()
        host.reportState()
        assertEquals(1, api.states.size)
        handlers.state = null
        host.reportState()
        assertEquals(1, api.states.size)
        assertNotNull(parseHandoffOffer(buildJsonObject { put("handoff_id", "h"); put("media_file_id", "m") }))
        assertNull(parseHandoffOffer(buildJsonObject { put("handoff_id", "h") }))
        assertTrue(true)
    }

    @Test
    fun `pushed events are handled and the stream resumes from the last seq`() = runBlocking {
        val api = FakeApi(); val handlers = FakeHandlers()
        api.streamSessions = ArrayDeque(
            listOf(listOf(event("handoff_stop", buildJsonObject { put("handoff_id", "h") }, "p1", seq = 9L))),
        )
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
        val host = host(api, handlers)
        host.start(scope)
        withTimeout(3_000) { while (api.streamCursors.size < 2) kotlinx.coroutines.delay(10) }
        host.stop()
        scope.cancel()
        assertEquals(listOf(0L, 9L), api.streamCursors.take(2))
        assertEquals(listOf("h"), handlers.stopped)
        assertEquals(listOf(Triple("p1", "ok", null)), api.acks.toList())
        assertTrue(api.inboxCursors.isEmpty())
        assertEquals("push", host.transport)
    }

    @Test
    fun `repeated stream failures fall back to long polling`() = runBlocking {
        val api = FakeApi(); val handlers = FakeHandlers()
        api.streamFailure = java.io.IOException("blocked")
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
        val host = host(api, handlers)
        host.start(scope)
        withTimeout(20_000) { while (api.inboxCursors.isEmpty()) kotlinx.coroutines.delay(10) }
        host.stop()
        scope.cancel()
        assertEquals(3, api.streamCursors.size)
        assertEquals("poll", host.transport)
    }
}
