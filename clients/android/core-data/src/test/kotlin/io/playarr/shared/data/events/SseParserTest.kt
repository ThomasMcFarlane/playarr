package io.playarr.shared.data.events

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class SseParserTest {
    @Test
    fun `parses id event and data`() {
        val frames = SseParser().feed("id: 7\nevent: change\ndata: {\"a\":1}\n\n")
        assertEquals(listOf(SseFrame("7", "change", "{\"a\":1}")), frames)
    }

    @Test
    fun `comment heartbeats are ignored and dispatch nothing`() {
        val parser = SseParser()
        assertTrue(parser.feed(": keep-alive\n\n: again\n").isEmpty())
        assertEquals(1, parser.feed("event: ready\ndata: {}\n\n").size)
    }

    @Test
    fun `multi line data is joined with newlines`() {
        val frame = SseParser().feed("data: one\ndata: two\ndata:three\n\n").single()
        assertEquals("one\ntwo\nthree", frame.data)
        assertEquals("message", frame.event)
        assertNull(frame.id)
    }

    @Test
    fun `frames split at every chunk boundary parse identically`() {
        val wire = "id: 1\r\nevent: ready\r\ndata: {\"seq\":1}\r\n\r\n: hb\n\nid: 2\nevent: change\ndata: x\n\n"
        val whole = SseParser().feed(wire)
        for (split in 1 until wire.length) {
            val parser = SseParser()
            val pieces = parser.feed(wire.substring(0, split)) + parser.feed(wire.substring(split))
            assertEquals("split at $split", whole, pieces)
        }
        assertEquals(2, whole.size)
    }

    @Test
    fun `one character at a time and bare carriage returns`() {
        val parser = SseParser()
        val frames = "event: resync\rdata: {}\r\r".map { parser.feed(it.toString()) }.flatten()
        assertEquals(listOf(SseFrame(null, "resync", "{}")), frames)
    }

    @Test
    fun `a frame without data is not dispatched and state resets between frames`() {
        val parser = SseParser()
        assertTrue(parser.feed("id: 9\nevent: ready\n\n").isEmpty())
        val frame = parser.feed("data: x\n\n").single()
        assertEquals(SseFrame(null, "message", "x"), frame)
    }

    @Test
    fun `typed decoding of the three frame kinds and unknown events`() {
        val ready = SseFrame("5", "ready", """{"seq":5,"retention_ms":600000,"heartbeat_ms":15000,"max_age_ms":300000,"server_time_ms":1000}""")
        assertEquals(LiveEvent.Ready(5, 600000, 15000, 300000, 1000), ready.toLiveEvent())
        val change = SseFrame("6", "change", """{"seq":6,"type":"watch","entity":"work","id":"w1","changed":["progress"],"at":123,"extra":true}""")
        assertEquals(LiveEvent.Change(6, "watch", "work", "w1", listOf("progress"), 123), change.toLiveEvent())
        val bulk = SseFrame("7", "change", """{"seq":7,"type":"library","entity":"*","changed":["bulk"],"at":1}""")
        assertEquals(LiveEvent.Change(7, "library", "*", null, listOf("bulk"), 1), bulk.toLiveEvent())
        assertEquals(LiveEvent.Resync(8, "cursor_too_old"), SseFrame("8", "resync", """{"reason":"cursor_too_old","seq":8}""").toLiveEvent())
        assertNull(SseFrame(null, "future", "{}").toLiveEvent())
        assertNull(SseFrame(null, "change", "not json").toLiveEvent())
    }
}
