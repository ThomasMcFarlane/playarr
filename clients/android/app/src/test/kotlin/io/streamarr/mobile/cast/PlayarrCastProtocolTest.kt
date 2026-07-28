package io.streamarr.mobile.cast

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

class PlayarrCastProtocolTest {

    @Test
    fun `namespace and protocol version match the canonical design`() {
        assertEquals("urn:x-cast:app.playarr.cast.v1", PLAYARR_CAST_NAMESPACE)
        assertEquals(1, PLAYARR_CAST_PROTOCOL_VERSION)
    }

    private fun sampleCredentials() = PlayarrCastCredentials(
        deviceId = "device-1",
        accessToken = "access-token",
        accessTokenExpiresAt = 1_700_000_000_000L,
        refreshToken = "refresh-token",
    )

    @Test
    fun `a load request round-trips and is recognised by its own guard`() {
        val request = PlayarrCastLoadRequest(
            server = PlayarrCastServer(baseUrl = "https://streamarr.example.com"),
            credentials = sampleCredentials(),
            item = PlayarrCastItem(
                mediaFileId = "media-1",
                kind = PlayarrCastItemKind.Episode,
                title = "Pilot",
                seasonNumber = 1,
                episodeNumber = 1,
            ),
            playback = PlayarrCastPlaybackIntent(startPositionMs = 0L, autoplay = true),
            sender = PlayarrCastSender(
                platform = PlayarrCastSenderPlatform.AndroidMobile,
                appVersion = "1.0.0",
                deviceName = "Pixel",
                language = "en-US",
            ),
        )
        val encoded = playarrCastJson.encodeToString(PlayarrCastLoadRequest.serializer(), request)

        assertTrue(isPlayarrCastLoadRequest(encoded))
        val decoded = playarrCastJson.decodeFromString(PlayarrCastLoadRequest.serializer(), encoded)
        assertEquals(request, decoded)
        // A load request is never sent on the custom-namespace message channel.
        assertFalse(isPlayarrCastSenderMessage(encoded))
        assertFalse(isPlayarrCastReceiverMessage(encoded))
    }

    @Test
    fun `every sender message type encodes with a flat camelCase type discriminator and round-trips`() {
        val messages: List<PlayarrCastSenderMessage> = listOf(
            PlayarrCastAuthUpdateMessage(credentials = sampleCredentials()),
            PlayarrCastSelectTracksMessage(audioTrackId = "audio-1", subtitleTrackId = null),
            PlayarrCastSelectQualityMessage(qualityId = "original"),
            PlayarrCastSetQueueMessage(
                items = listOf(PlayarrCastQueueEntry(mediaFileId = "media-2", kind = PlayarrCastItemKind.Movie, title = "A Movie")),
            ),
            PlayarrCastPlayNextMessage(),
            PlayarrCastRequestStateMessage(),
            PlayarrCastEndSessionMessage(reason = PlayarrCastStopReason.UserStopped),
        )
        val expectedTypes = listOf(
            "auth.update", "tracks.select", "quality.select", "queue.set", "queue.playNext", "state.request", "session.end",
        )

        messages.forEachIndexed { index, message ->
            val encoded = encodePlayarrCastMessage(message)
            val json = Json.parseToJsonElement(encoded).jsonObject
            assertEquals(expectedTypes[index], json.getValue("type").jsonPrimitive.content)
            assertEquals(1, json.getValue("protocolVersion").jsonPrimitive.content.toInt())

            assertTrue("$message should be recognised as a sender message", isPlayarrCastSenderMessage(encoded))
            assertFalse("$message must not be recognised as a receiver message", isPlayarrCastReceiverMessage(encoded))
            assertEquals(message, parsePlayarrCastMessage(encoded))
        }
    }

    @Test
    fun `every receiver message type encodes with a flat camelCase type discriminator and round-trips`() {
        val messages: List<PlayarrCastReceiverMessage> = listOf(
            PlayarrCastReadyMessage(
                receiverVersion = "1.0.0",
                supportedProtocolVersion = 1,
                deviceCapabilities = PlayarrCastDeviceCapabilities(
                    supportsH264 = true, supportsHevc = true, supportsVp9 = false,
                    supportsAv1 = false, supports4k = true, supportsHdr = false,
                ),
            ),
            PlayarrCastStateMessage(
                mediaFileId = "media-1",
                sessionId = "session-1",
                sourceOffsetMs = 0L,
                positionMs = 5_000L,
                durationMs = 60_000L,
                selectedQualityId = "original",
            ),
            PlayarrCastAuthRotatedMessage(credentials = sampleCredentials()),
            PlayarrCastErrorMessage(code = PlayarrCastErrorCode.NegotiationFailed, message = "boom", retryable = true),
            PlayarrCastAckMessage(requestId = "request-1", ok = true),
        )
        val expectedTypes = listOf("ready", "state", "auth.rotated", "error", "ack")

        messages.forEachIndexed { index, message ->
            val encoded = encodePlayarrCastMessage(message)
            val json = Json.parseToJsonElement(encoded).jsonObject
            assertEquals(expectedTypes[index], json.getValue("type").jsonPrimitive.content)

            assertTrue("$message should be recognised as a receiver message", isPlayarrCastReceiverMessage(encoded))
            assertFalse("$message must not be recognised as a sender message", isPlayarrCastSenderMessage(encoded))
            assertEquals(message, parsePlayarrCastMessage(encoded))
        }
    }

    @Test
    fun `an ack always carries its own requestId even though the envelope's is optional`() {
        val ack = PlayarrCastAckMessage(requestId = "abc-123", ok = false, code = PlayarrCastErrorCode.AuthFailed, message = "nope")
        val encoded = encodePlayarrCastMessage(ack)
        val json = Json.parseToJsonElement(encoded).jsonObject
        assertEquals("abc-123", json.getValue("requestId").jsonPrimitive.content)
        assertEquals(ack, parsePlayarrCastMessage(encoded))
    }

    @Test
    fun `parsePlayarrCastMessage never throws on garbage input`() {
        assertNull(parsePlayarrCastMessage(""))
        assertNull(parsePlayarrCastMessage("not json at all"))
        assertNull(parsePlayarrCastMessage("{}"))
        assertNull(parsePlayarrCastMessage("""{"type":"not.a.real.type","protocolVersion":1}"""))
        assertNull(parsePlayarrCastMessage("""{"type":"state.request""""))
    }

    @Test
    fun `the guard functions never throw on garbage input either`() {
        assertFalse(isPlayarrCastLoadRequest("garbage"))
        assertFalse(isPlayarrCastSenderMessage("garbage"))
        assertFalse(isPlayarrCastReceiverMessage("garbage"))
    }

    @Test
    fun `encoding refuses a message that would exceed the 64 KB channel cap`() {
        val oversized = PlayarrCastSetQueueMessage(
            items = List(5_000) { index ->
                PlayarrCastQueueEntry(
                    mediaFileId = "media-$index",
                    kind = PlayarrCastItemKind.Episode,
                    title = "Episode title padding to grow this payload well past the cap $index",
                )
            },
        )
        try {
            encodePlayarrCastMessage(oversized)
            fail("expected an IllegalArgumentException past the 64 KB cap")
        } catch (expected: IllegalArgumentException) {
            assertTrue(expected.message.orEmpty().contains("channel cap"))
        }
    }

    @Test
    fun `item kind wire values match the design's closed vocabulary`() {
        assertEquals("movie", wireValueOf(PlayarrCastItemKind.Movie))
        assertEquals("episode", wireValueOf(PlayarrCastItemKind.Episode))
        assertEquals("track", wireValueOf(PlayarrCastItemKind.Track))
        assertEquals("other", wireValueOf(PlayarrCastItemKind.Other))
    }

    private fun wireValueOf(kind: PlayarrCastItemKind): String {
        val message = PlayarrCastSetQueueMessage(
            items = listOf(PlayarrCastQueueEntry(mediaFileId = "m", kind = kind, title = "t")),
        )
        val itemsJson = Json.parseToJsonElement(encodePlayarrCastMessage(message)).jsonObject.getValue("items")
        return itemsJson.jsonArray[0].jsonObject.getValue("kind").jsonPrimitive.content
    }
}
