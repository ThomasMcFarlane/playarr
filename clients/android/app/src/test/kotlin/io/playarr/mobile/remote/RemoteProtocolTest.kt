package io.playarr.mobile.remote

import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class RemoteProtocolTest {
    private class FakePlayer(
        var position: Long = 60_000L,
        var duration: Long = 120_000L,
        var paused: Boolean = false,
        var audio: Boolean = true,
        var hasNext: Boolean = false,
    ) : RemotePlayerControls {
        val calls = mutableListOf<String>()
        override val mediaFileId = "m1"
        override fun positionMs() = position
        override fun durationMs() = duration
        override fun isPaused() = paused
        override fun isReady() = true
        override fun hasStarted() = true
        override fun play() { calls += "play" }
        override fun pause() { calls += "pause" }
        override fun seekToMs(positionMs: Long) { calls += "seek:$positionMs" }
        override fun setVolume(level: Float): Boolean = false
        override fun stop() { calls += "stop" }
        override fun next(): Boolean = hasNext.also { if (it) calls += "next" }
        override fun previous(): Boolean = false
        override fun setAudioLanguage(language: String): Boolean = audio.also { if (it) calls += "audio:$language" }
        override fun setSubtitleLanguage(language: String?): Boolean { calls += "subs:$language"; return true }
    }

    private fun args(action: String, vararg extra: Pair<String, Long>): JsonObject = buildJsonObject {
        put("action", action)
        extra.forEach { (k, v) -> put(k, v) }
    }

    @Test
    fun `keys map and unknown names are rejected`() {
        assertEquals(RemoteKey.Up, remoteKeyFor("up"))
        assertEquals(RemoteKey.Home, remoteKeyFor("home"))
        assertNull(remoteKeyFor("teleport"))
    }

    @Test
    fun `text insert replaces selection and clamps range`() {
        val insert = TextCommand("XY", "insert", false)
        assertEquals(TextEdit("abXYcd", 4), applyTextCommand("abcd", 2, 2, insert))
        assertEquals(TextEdit("a-d", 2), applyTextCommand("abcd", 1, 3, TextCommand("-", "insert", false)))
        assertEquals(TextEdit("abc", 3), applyTextCommand("ab", 9, 12, TextCommand("c", "insert", false)))
    }

    @Test
    fun `text replace and backspace behave`() {
        assertEquals(TextEdit("new", 3), applyTextCommand("old", 0, 0, TextCommand("new", "replace", false)))
        val back = TextCommand("", "backspace", false)
        assertEquals(TextEdit("ab", 2), applyTextCommand("abc", 3, 3, back))
        assertEquals(TextEdit("abc", 0), applyTextCommand("abc", 0, 0, back))
        assertEquals(TextEdit("c", 0), applyTextCommand("abc", 0, 2, back))
    }

    @Test
    fun `text arguments default safely`() {
        assertEquals(TextCommand("", "insert", false), parseTextCommand(JsonObject(emptyMap())))
        val parsed = parseTextCommand(buildJsonObject {
            put("value", "x")
            put("mode", "bogus")
            put("submit", true)
        })
        assertEquals(TextCommand("x", "insert", true), parsed)
    }

    @Test
    fun `playback commands drive the player`() {
        val player = FakePlayer()
        executePlaybackCommand(player, args("pause"))
        executePlaybackCommand(player, args("play"))
        executePlaybackCommand(player, args("toggle"))
        executePlaybackCommand(player, args("stop"))
        assertEquals(listOf("pause", "play", "pause", "stop"), player.calls)
    }

    @Test
    fun `seeking is absolute or relative and clamped`() {
        val player = FakePlayer()
        executePlaybackCommand(player, args("seek", "position_ms" to 5_000L))
        executePlaybackCommand(player, args("seek_by", "delta_ms" to -10_000L))
        executePlaybackCommand(player, args("seek_by", "delta_ms" to 999_999L))
        executePlaybackCommand(player, args("seek_by", "delta_ms" to -999_999L))
        assertEquals(listOf("seek:5000", "seek:50000", "seek:120000", "seek:0"), player.calls)
        assertTrue(executePlaybackCommand(player, args("seek")) is RemoteOutcome.Failed)
    }

    @Test
    fun `nothing playing and unsupported controls are reported honestly`() {
        assertTrue(executePlaybackCommand(null, args("pause")) is RemoteOutcome.Failed)
        val player = FakePlayer()
        assertTrue(executePlaybackCommand(player, buildJsonObject { put("action", "volume"); put("level", 50L) }) is RemoteOutcome.Unsupported)
        assertTrue(executePlaybackCommand(player, args("next")) is RemoteOutcome.Unsupported)
        assertTrue(executePlaybackCommand(player, args("previous")) is RemoteOutcome.Unsupported)
        assertTrue(executePlaybackCommand(player, args("warp")) is RemoteOutcome.Unsupported)
    }

    @Test
    fun `track selection by language reports misses`() {
        val player = FakePlayer(audio = false)
        assertTrue(executePlaybackCommand(player, buildJsonObject { put("action", "set_audio"); put("language", "fr") }) is RemoteOutcome.Failed)
        executePlaybackCommand(player, buildJsonObject { put("action", "set_subtitle"); put("language", "off") })
        assertEquals(listOf("subs:null"), player.calls)
    }

    @Test
    fun `outcomes expose wire status and detail`() {
        assertEquals("ok", RemoteOutcome.Ok.wire)
        assertNull(RemoteOutcome.Ok.detailOrNull)
        assertEquals("failed", RemoteOutcome.Failed("x").wire)
        assertEquals("x", RemoteOutcome.Unsupported("x").detailOrNull)
    }

    @Test
    fun `json helpers read primitives`() {
        val obj = JsonObject(mapOf("a" to JsonPrimitive("s"), "n" to JsonPrimitive(5)))
        assertEquals("s", obj.string("a"))
        assertEquals(5L, obj.long("n"))
        assertNull(obj.string("missing"))
    }

    @Test
    fun `sse frames are split across lines and keep-alives are ignored`() = kotlinx.coroutines.runBlocking {
        val frames = mutableListOf<Pair<String, String>>()
        val text = "event: ready\ndata: {}\n\n: keep-alive\n\nevent: inbox\nid: 3\ndata: {\"seq\":3}\n\n"
        readSseFrames(java.io.BufferedReader(java.io.StringReader(text))) { e, d -> frames += e to d }
        assertEquals(listOf("ready" to "{}", "inbox" to "{\"seq\":3}"), frames)
    }
}
