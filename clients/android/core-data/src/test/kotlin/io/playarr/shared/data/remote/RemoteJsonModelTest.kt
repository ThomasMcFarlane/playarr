package io.playarr.shared.data.remote

import io.playarr.shared.data.model.AckRemoteHandoffRequest
import io.playarr.shared.data.model.CreateRemoteHandoffRequest
import io.playarr.shared.data.model.RemoteHandoff
import io.playarr.shared.data.model.RemoteInbox
import io.playarr.shared.data.model.RemotePairing
import io.playarr.shared.data.model.RemotePlaybackSnapshot
import io.playarr.shared.data.model.RemoteTarget
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** The remote DTOs must match the server's snake_case JSON (`backend/openapi/playarr.yaml`). */
class RemoteJsonModelTest {
    private val json = PlayarrHttpClient.json

    @Test
    fun `decodes a target and a pairing as the server sends them`() {
        val target = json.decodeFromString<RemoteTarget>(
            """{"device_id":"d1","name":"Living room TV","platform":"android-tv","capabilities":["navigate","handoff"],"online":true,"is_self":false,"state":null}""",
        )
        assertEquals("d1", target.deviceId)
        assertTrue(target.online)
        assertFalse(target.isSelf)
        assertNull(target.state)

        val pairing = json.decodeFromString<RemotePairing>(
            """{"id":"p1","status":"pending","controller_device_id":"c","controller_name":"Phone","target_device_id":"d1","scopes":["navigate"],"verification_code":"123456","created_ms":1,"expires_ms":2,"is_controller":true,"is_target":false}""",
        )
        assertEquals("123456", pairing.verificationCode)
        assertTrue(pairing.isController)
    }

    @Test
    fun `decodes inbox events with arbitrary payloads and tolerates new fields`() {
        val inbox = json.decodeFromString<RemoteInbox>(
            """{"events":[{"id":"e1","seq":3,"kind":"command","pairing_id":"p1","payload":{"kind":"navigate","args":{"key":"up"}},"created_ms":1,"expires_ms":2,"future":true}],"next":3}""",
        )
        assertEquals(3L, inbox.next)
        assertEquals("command", inbox.events.single().kind)
        assertTrue(inbox.events.single().payload.toString().contains("\"key\":\"up\""))
    }

    @Test
    fun `decodes a handoff including drift and encodes requests in snake case`() {
        val handoff = json.decodeFromString<RemoteHandoff>(
            """{"id":"h1","status":"committed","source_device_id":"s","destination_device_id":"d","media_file_id":"m","work_id":"w","snapshot":{"position_ms":1000,"paused":false},"acked_position_ms":1100,"position_drift_ms":100,"created_ms":1,"expires_ms":2,"completed_ms":3}""",
        )
        assertEquals(1100L, handoff.ackedPositionMs)
        assertEquals(100L, handoff.positionDriftMs)

        val request = json.encodeToString(
            CreateRemoteHandoffRequest.serializer(),
            CreateRemoteHandoffRequest("k", "s", "d", "m", RemotePlaybackSnapshot(5L, paused = true)),
        )
        assertTrue(request.contains("\"request_key\":\"k\""))
        assertTrue(request.contains("\"source_device_id\":\"s\""))
        assertTrue(request.contains("\"position_ms\":5"))
        assertEquals(
            "{\"status\":\"playing\",\"position_ms\":9}",
            json.encodeToString(AckRemoteHandoffRequest.serializer(), AckRemoteHandoffRequest("playing", positionMs = 9L)),
        )
    }
}
