package io.playarr.shared.data.events

import java.io.IOException
import java.io.Reader
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.launch
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.withContext

/** Where the live stream stands; drives fallback polling. */
enum class LiveConnectionState {
    /** Not subscribed (background, signed out). */
    Idle,
    Connecting,

    /** A `200 text/event-stream` is open. */
    Connected,

    /** The stream dropped or failed; backing off before the next attempt. Polling is active. */
    Reconnecting,

    /** The server has no event stream. Polling is active; no retry until the next foreground, sign-in or server change. */
    Unsupported,
}

/** The HTTP outcome of opening the stream, before any frame is read. */
class LiveEventsResponse(
    val code: Int,
    val contentType: String?,
    val reader: Reader?,
    val close: () -> Unit,
)

fun interface LiveEventsTransport {
    suspend fun open(lastEventId: Long?): LiveEventsResponse
}

/** Adapts the Retrofit [LiveEventsApi]; [ConnectException][IOException]s propagate to the connection's backoff. */
fun LiveEventsApi.asTransport(): LiveEventsTransport = LiveEventsTransport { lastEventId ->
    val response = events(lastEventId?.toString())
    val body = response.body() ?: response.errorBody()
    LiveEventsResponse(
        code = response.code(),
        contentType = response.headers()["Content-Type"] ?: body?.contentType()?.toString(),
        reader = if (response.isSuccessful) body?.charStream() else null,
        close = { body?.close() },
    )
}

/** `true` when [code] and [contentType] describe a real event stream. */
internal fun isEventStream(code: Int, contentType: String?): Boolean =
    code == 200 && contentType?.substringBefore(';')?.trim().equals("text/event-stream", ignoreCase = true)

/**
 * Anything that is not `200 text/event-stream` is unsupported (older servers
 * answer unknown paths with the app shell HTML or a 404) -- except transient
 * conditions, which are retried with backoff.
 */
internal fun isTransientStatus(code: Int): Boolean = code == 401 || code == 408 || code == 429 || code >= 500

/** Reconnect backoff: 1 s, 2 s, 4 s ... capped at 30 s, with downward jitter so the cap is never exceeded. */
object LiveBackoff {
    const val MIN_MS = 1_000L
    const val MAX_MS = 30_000L
    const val STABLE_MS = 60_000L

    /** [attempt] is 1 for the first retry; [random] is in `[0, 1)`. Result is in `[0.75 * base, base]`. */
    fun delayMs(attempt: Int, random: Double): Long {
        val exponent = (attempt - 1).coerceIn(0, 20)
        val base = minOf(MAX_MS, MIN_MS shl exponent)
        return (base * (0.75 + 0.25 * random.coerceIn(0.0, 1.0))).toLong()
    }
}

/** What [LiveEventsManager] drives; [LiveEventsConnection] is the real one, tests use fakes. */
interface LiveEventsSession {
    val lastEventId: Long?
    fun resetCursor()

    /** Runs until cancelled or the server proves unsupported (then returns after reporting [LiveConnectionState.Unsupported]). */
    suspend fun run(onState: (LiveConnectionState) -> Unit, onEvent: (LiveEvent) -> Unit)
}

/**
 * One reconnecting subscription to `GET /api/v1/events`. [run] loops until it
 * is cancelled (pause) or the server proves unsupported. The Last-Event-ID
 * cursor survives pauses so a resume replays what was missed.
 */
class LiveEventsConnection(
    private val transport: LiveEventsTransport,
    /** Monotonic milliseconds. */
    private val clock: () -> Long = { System.nanoTime() / 1_000_000L },
    private val sleep: suspend (Long) -> Unit = { delay(it) },
    private val random: () -> Double = { Math.random() },
) : LiveEventsSession {
    @Volatile
    override var lastEventId: Long? = null
        private set

    /** Forget the cursor (different server or account: a cursor from another domain is meaningless). */
    override fun resetCursor() {
        lastEventId = null
    }

    private sealed interface Outcome {
        data object Unsupported : Outcome

        /** The stream was open for [upMs] and then ended or failed. */
        data class Ended(val upMs: Long, val failed: Boolean) : Outcome
    }

    override suspend fun run(onState: (LiveConnectionState) -> Unit, onEvent: (LiveEvent) -> Unit) {
        var attempt = 0
        try {
            while (true) {
                onState(LiveConnectionState.Connecting)
                when (val outcome = connectOnce(onState, onEvent)) {
                    Outcome.Unsupported -> {
                        onState(LiveConnectionState.Unsupported)
                        return
                    }
                    is Outcome.Ended -> {
                        if (outcome.upMs >= LiveBackoff.STABLE_MS) attempt = 0
                        // The server's own five-minute close (stable, not failed) reconnects at once.
                        if (!outcome.failed && outcome.upMs >= LiveBackoff.STABLE_MS) continue
                        attempt++
                        onState(LiveConnectionState.Reconnecting)
                        sleep(LiveBackoff.delayMs(attempt, random()))
                    }
                }
            }
        } catch (cancelled: CancellationException) {
            onState(LiveConnectionState.Idle)
            throw cancelled
        }
    }

    private suspend fun connectOnce(onState: (LiveConnectionState) -> Unit, onEvent: (LiveEvent) -> Unit): Outcome {
        val response = try {
            transport.open(lastEventId)
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (_: Exception) {
            return Outcome.Ended(0, failed = true)
        }
        if (!isEventStream(response.code, response.contentType) || response.reader == null) {
            response.close()
            return if (isTransientStatus(response.code)) Outcome.Ended(0, failed = true) else Outcome.Unsupported
        }
        val startedAt = clock()
        return withContext(Dispatchers.IO) {
            // Blocking reads are not cancellable; closing the body unblocks them, so a
            // sibling coroutine closes it the moment this one is cancelled (pause).
            val watcher = launch {
                try {
                    awaitCancellation()
                } finally {
                    response.close()
                }
            }
            try {
                onState(LiveConnectionState.Connected)
                readSseStream(response.reader) { frame ->
                    val event = frame.toLiveEvent() ?: return@readSseStream
                    if (event.seq > (lastEventId ?: -1L)) lastEventId = event.seq
                    onEvent(event)
                }
                Outcome.Ended(clock() - startedAt, failed = false)
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (_: IOException) {
                if (!isActive) throw CancellationException("live events paused")
                Outcome.Ended(clock() - startedAt, failed = true)
            } finally {
                watcher.cancel()
                response.close()
            }
        }
    }
}
