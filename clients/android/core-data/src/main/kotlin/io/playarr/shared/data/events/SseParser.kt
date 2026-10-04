package io.playarr.shared.data.events

import java.io.Reader

/** One dispatched server-sent-events frame. [id] is the frame's own `id:` field, when it had one. */
data class SseFrame(val id: String?, val event: String, val data: String)

/**
 * Incremental parser for the `text/event-stream` wire format. Feed it
 * arbitrary chunks (a frame, a line or even a CR/LF pair may be split across
 * chunk boundaries); it returns the frames completed by each chunk. Comment
 * lines (heartbeats) and unknown fields are ignored; multi-line `data:` is
 * joined with `\n`; a frame without data is not dispatched.
 */
class SseParser {
    private val line = StringBuilder()
    private var skipLf = false
    private var event = "message"
    private var id: String? = null
    private val data = StringBuilder()
    private var hasData = false

    fun feed(chunk: CharSequence): List<SseFrame> {
        var frames: MutableList<SseFrame>? = null
        for (ch in chunk) {
            if (skipLf) {
                skipLf = false
                if (ch == '\n') continue
            }
            if (ch == '\n' || ch == '\r') {
                if (ch == '\r') skipLf = true
                val frame = endOfLine()
                if (frame != null) (frames ?: mutableListOf<SseFrame>().also { frames = it }).add(frame)
            } else {
                line.append(ch)
            }
        }
        return frames ?: emptyList()
    }

    private fun endOfLine(): SseFrame? {
        val text = line.toString()
        line.setLength(0)
        if (text.isEmpty()) {
            val frame = if (hasData) SseFrame(id, event, data.toString()) else null
            event = "message"
            id = null
            data.setLength(0)
            hasData = false
            return frame
        }
        if (text.startsWith(":")) return null
        val colon = text.indexOf(':')
        val field = if (colon < 0) text else text.substring(0, colon)
        val value = if (colon < 0) "" else text.substring(colon + 1).removePrefix(" ")
        when (field) {
            "event" -> event = value
            "id" -> if ('\u0000' !in value) id = value
            "data" -> {
                if (hasData) data.append('\n')
                data.append(value)
                hasData = true
            }
        }
        return null
    }
}

/** Reads [reader] to the end (or until it throws, e.g. when the call is cancelled), dispatching each frame. */
internal suspend fun readSseStream(reader: Reader, onFrame: suspend (SseFrame) -> Unit) {
    val parser = SseParser()
    val buffer = CharArray(4096)
    while (true) {
        val read = reader.read(buffer)
        if (read < 0) return
        for (frame in parser.feed(java.nio.CharBuffer.wrap(buffer, 0, read))) onFrame(frame)
    }
}
