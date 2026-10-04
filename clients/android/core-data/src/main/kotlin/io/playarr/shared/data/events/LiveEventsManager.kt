package io.playarr.shared.data.events

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull

/**
 * Lifecycle-aware owner of the live event subscription. It streams only while
 * the app is foregrounded *and* signed in ([setForeground], [setSession]),
 * cancels the call in the background and resumes with the Last-Event-ID
 * cursor, turns frames into coalesced [Invalidation]s on [bus], and drives
 * fallback polling while the stream is down or unsupported.
 */
class LiveEventsManager(
    private val scope: CoroutineScope,
    private val session: LiveEventsSession,
    val bus: LiveInvalidationBus,
    /** Fallback refresh cadence: 30 s in the foreground, 60 s on TV. */
    private val pollIntervalMs: Long,
    /** Trailing debounce for bursts of events. */
    private val coalesceMs: Long = DEFAULT_COALESCE_MS,
    private val monotonicMs: () -> Long = { System.nanoTime() / 1_000_000L },
    private val wallClockMs: () -> Long = System::currentTimeMillis,
) {
    private val lock = Any()
    private val _state = MutableStateFlow(LiveConnectionState.Idle)
    val state: StateFlow<LiveConnectionState> = _state.asStateFlow()

    private val _polling = MutableStateFlow(false)

    /** `true` while the stream is down or unsupported in the foreground, i.e. fallback ticks are being emitted. */
    val polling: StateFlow<Boolean> = _polling.asStateFlow()

    private var foreground = false
    private var sessionKey: String? = null
    private var streamJob: Job? = null
    private var generation = 0L

    /** Monotonic time the stream last stopped being healthy; null while healthy or never connected. */
    private var downSince: Long? = null
    private var retentionMs = DEFAULT_RETENTION_MS
    private var clockOffsetMs = 0L

    private val pending = Channel<Invalidation>(Channel.UNLIMITED)

    init {
        scope.launch {
            for (first in pending) {
                var merged = first
                var count = 1
                while (count < MAX_COALESCED) {
                    val next = withTimeoutOrNull(coalesceMs) { pending.receive() } ?: break
                    merged = merged.merge(next)
                    count++
                }
                bus.publish(merged)
            }
        }
        scope.launch {
            _polling.collectLatest { down ->
                if (!down) return@collectLatest
                while (true) {
                    delay(pollIntervalMs)
                    bus.publish(Invalidation(poll = true))
                }
            }
        }
    }

    fun setForeground(value: Boolean) = synchronized(lock) {
        if (foreground == value) return@synchronized
        foreground = value
        reconcile()
    }

    /** [key] identifies server + account, or `null` when signed out; a change drops the cursor. */
    fun setSession(key: String?) = synchronized(lock) {
        if (sessionKey == key) return@synchronized
        stop(markDown = false)
        session.resetCursor()
        downSince = null
        sessionKey = key
        reconcile()
    }

    private fun reconcile() {
        val wanted = foreground && sessionKey != null
        if (wanted && streamJob == null) start()
        if (!wanted && streamJob != null) stop(markDown = true)
    }

    private fun start() {
        val away = downSince
        if (away != null && monotonicMs() - away > retentionMs) {
            // Backgrounded (or offline) longer than the server keeps events: the cursor is useless.
            downSince = null
            bus.publish(Invalidation(everything = true, atLocalMs = wallClockMs()))
        }
        val mine = ++generation
        streamJob = scope.launch {
            session.run(
                onState = { s -> synchronized(lock) { if (generation == mine) onState(s) } },
                onEvent = { e -> synchronized(lock) { if (generation == mine) onEvent(e) } },
            )
        }
    }

    private fun stop(markDown: Boolean) {
        streamJob?.cancel()
        streamJob = null
        generation++
        if (markDown && downSince == null) downSince = monotonicMs()
        _polling.value = false
        _state.value = LiveConnectionState.Idle
    }

    private fun onState(next: LiveConnectionState) {
        _state.value = next
        when (next) {
            LiveConnectionState.Connected, LiveConnectionState.Idle -> _polling.value = false
            LiveConnectionState.Reconnecting, LiveConnectionState.Unsupported -> {
                if (downSince == null) downSince = monotonicMs()
                _polling.value = true
            }
            LiveConnectionState.Connecting -> Unit
        }
    }

    private fun onEvent(event: LiveEvent) {
        when (event) {
            is LiveEvent.Ready -> {
                retentionMs = event.retentionMs.takeIf { it > 0 } ?: DEFAULT_RETENTION_MS
                if (event.serverTimeMs > 0) clockOffsetMs = event.serverTimeMs - wallClockMs()
                val away = downSince
                downSince = null
                // A reconnect after a gap longer than the server retains is refetched once.
                if (away != null && monotonicMs() - away > retentionMs) {
                    pending.trySend(Invalidation(everything = true, atLocalMs = wallClockMs()))
                }
            }
            is LiveEvent.Resync -> pending.trySend(Invalidation(everything = true, atLocalMs = wallClockMs()))
            is LiveEvent.Change -> {
                val targets = LiveEventMapper.targetsFor(event) ?: return
                val atLocal = event.at.takeIf { it > 0 }?.let { it - clockOffsetMs }
                pending.trySend(Invalidation(targets = targets, atLocalMs = atLocal))
            }
        }
    }

    companion object {
        const val DEFAULT_COALESCE_MS = 200L
        const val FOREGROUND_POLL_MS = 30_000L
        const val TELEVISION_POLL_MS = 60_000L
        private const val MAX_COALESCED = 200
    }
}
