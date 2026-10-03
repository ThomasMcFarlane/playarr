package io.playarr.shared.player

import androidx.media3.common.Format
import androidx.media3.exoplayer.DefaultLoadControl
import androidx.media3.exoplayer.LoadControl
import androidx.media3.exoplayer.analytics.PlayerId
import androidx.media3.exoplayer.source.TrackGroupArray
import androidx.media3.exoplayer.trackselection.ExoTrackSelection
import androidx.media3.exoplayer.upstream.Allocator

/** Where the stream bitrate used by the policy and telemetry came from. */
internal enum class BitrateSource(val label: String) { DECLARED("declared"), DERIVED("derived"), UNKNOWN("unknown") }

internal data class ResolvedBitrate(val bps: Long, val source: BitrateSource)

internal object StreamBitrate {
    /** Declared bitrate of [format]: average, else overall, else peak; 0 when none is set. */
    fun declaredBps(format: Format): Long = when {
        format.averageBitrate != Format.NO_VALUE -> format.averageBitrate.toLong()
        format.bitrate != Format.NO_VALUE -> format.bitrate.toLong()
        format.peakBitrate != Format.NO_VALUE -> format.peakBitrate.toLong()
        else -> 0L
    }

    /**
     * The declared bitrate when known, otherwise the one derived from content
     * length and duration (MKV tracks usually declare none), otherwise unknown.
     */
    fun resolve(declaredBps: Long, derivedBps: Long): ResolvedBitrate = when {
        declaredBps > 0 -> ResolvedBitrate(declaredBps, BitrateSource.DECLARED)
        derivedBps > 0 -> ResolvedBitrate(derivedBps, BitrateSource.DERIVED)
        else -> ResolvedBitrate(0L, BitrateSource.UNKNOWN)
    }
}

/** Last post-seek start threshold chosen, for the `seek_ready` line; -1 when none was evaluated. */
internal object SeekStartTelemetry {
    @Volatile var thresholdMs = -1L
}

/** Pure tuning decisions behind [AdaptiveLoadControl]; JVM-testable. */
internal object SeekBufferPolicy {
    /**
     * Post-seek start thresholds by headroom h = throughput / bitrate. After
     * resume the buffer grows by about (h - 1) x real time while playing, so
     * the more headroom, the less must be queued up front: 3 s at h >= 2
     * (grows >= 1 s per s), 4 s at h >= 1.5, 5 s at h >= 1.2 (still +0.2 s
     * per s). Below 1.2 growth is too slow to trust: keep the default 10 s.
     * Should the buffer drain anyway, a rebuffer still waits for its 15 s
     * cushion, and one in the last 60 s reverts to 10 s.
     */
    const val FAST_START_US = 3_000_000L // h >= 2.0
    const val MEDIUM_START_US = 4_000_000L // 1.5 <= h < 2.0
    const val SLOW_START_US = 5_000_000L // 1.2 <= h < 1.5

    /** Default post-seek start (and initial start) threshold, as reported when no faster one applies. */
    const val DEFAULT_START_MS = 10_000L

    /** A rebuffer this recent means the link is not to be trusted: keep the default. */
    const val REBUFFER_GUARD_MS = 60_000L

    const val MAX_BACK_BUFFER_US = 30_000_000L

    /** Assumed when the selected tracks do not declare a bitrate: 80 Mbps. */
    const val WORST_CASE_BITRATE_BPS = 80_000_000L

    /**
     * Start threshold in us, or null to defer to the default load control.
     * Only a post-seek start (not the initial one, and not a rebuffer, which
     * keeps its 15 s cushion) with known bitrate and throughput qualifies, and
     * not within [REBUFFER_GUARD_MS] of a rebuffer. Headroom is compared in
     * integer tenths to keep the tier boundaries exact.
     */
    fun startThresholdUs(
        rebuffering: Boolean,
        startedOnce: Boolean,
        bitrateBps: Long,
        throughputBps: Long,
        msSinceRebuffer: Long = Long.MAX_VALUE,
    ): Long? {
        if (rebuffering || !startedOnce || bitrateBps <= 0 || throughputBps <= 0) return null
        if (msSinceRebuffer < REBUFFER_GUARD_MS) return null
        val scaled = throughputBps * 10
        return when {
            scaled >= bitrateBps * 20 -> FAST_START_US
            scaled >= bitrateBps * 15 -> MEDIUM_START_US
            scaled >= bitrateBps * 12 -> SLOW_START_US
            else -> null
        }
    }

    /**
     * Back buffer in us: up to [MAX_BACK_BUFFER_US], but never more than
     * [budgetBytes] worth of the actual (or worst-case) bitrate. The retained
     * bytes share the allocator the heap cap applies to, so an unbounded back
     * buffer would starve forward loading.
     */
    fun backBufferUs(budgetBytes: Long, bitrateBps: Long): Long {
        val rate = if (bitrateBps > 0) bitrateBps else WORST_CASE_BITRATE_BPS
        return (budgetBytes * 8L * 1_000_000L / rate).coerceIn(0L, MAX_BACK_BUFFER_US)
    }
}

/**
 * [DefaultLoadControl] plus two seek-oriented behaviours Media3 lacks:
 *
 * - a lower start threshold after a seek (3-5 s by throughput headroom, see
 *   [SeekBufferPolicy]; 10 s if a rebuffer occurred in the last 60 s) (Media3 uses the same `bufferForPlaybackMs` for the initial
 *   start and for every seek; the initial start stays at the conservative
 *   default because the bandwidth estimate is unreliable before any transfer,
 *   and a 2.5 s start drained on every peak when only 4 connections were used);
 * - a back buffer sized from the selected tracks' bitrate, so ~30 s is kept
 *   for ordinary content and shrinks for 4K remuxes to fit [backBufferBudgetBytes].
 */
internal class AdaptiveLoadControl(
    private val delegate: DefaultLoadControl,
    private val backBufferBudgetBytes: Long,
    private val throughputBps: () -> Long,
    private val derivedBitrateBps: () -> Long = { 0L },
    private val clockMs: () -> Long = android.os.SystemClock::elapsedRealtime,
) : LoadControl {
    @Volatile private var declaredBitrateBps = 0L

    private fun bitrateBps(): Long = StreamBitrate.resolve(declaredBitrateBps, derivedBitrateBps()).bps

    @Volatile private var startedOnce = false
    @Volatile private var lastRebufferMs = Long.MIN_VALUE / 2

    override fun onPrepared(playerId: PlayerId) {
        startedOnce = false
        delegate.onPrepared(playerId)
    }

    override fun onTracksSelected(
        parameters: LoadControl.Parameters,
        trackGroups: TrackGroupArray,
        trackSelections: Array<out ExoTrackSelection?>,
    ) {
        declaredBitrateBps = trackSelections.filterNotNull().sumOf { StreamBitrate.declaredBps(it.selectedFormat) }
        delegate.onTracksSelected(parameters, trackGroups, trackSelections)
    }

    override fun onStopped(playerId: PlayerId) {
        startedOnce = false
        delegate.onStopped(playerId)
    }

    override fun onReleased(playerId: PlayerId) = delegate.onReleased(playerId)

    override fun getAllocator(playerId: PlayerId): Allocator = delegate.getAllocator(playerId)

    override fun getBackBufferDurationUs(playerId: PlayerId): Long =
        SeekBufferPolicy.backBufferUs(backBufferBudgetBytes, bitrateBps())

    override fun retainBackBufferFromKeyframe(playerId: PlayerId): Boolean = true

    override fun shouldContinueLoading(parameters: LoadControl.Parameters): Boolean =
        delegate.shouldContinueLoading(parameters)

    override fun shouldContinuePreloading(
        playerId: PlayerId,
        timeline: androidx.media3.common.Timeline,
        mediaPeriodId: androidx.media3.exoplayer.source.MediaSource.MediaPeriodId,
        bufferedDurationUs: Long,
    ): Boolean = delegate.shouldContinuePreloading(playerId, timeline, mediaPeriodId, bufferedDurationUs)

    override fun shouldStartPlayback(parameters: LoadControl.Parameters): Boolean {
        val now = clockMs()
        if (parameters.rebuffering) lastRebufferMs = now
        val fast = SeekBufferPolicy.startThresholdUs(
            parameters.rebuffering,
            startedOnce,
            bitrateBps(),
            throughputBps(),
            now - lastRebufferMs,
        )
        if (startedOnce && !parameters.rebuffering) {
            SeekStartTelemetry.thresholdMs = fast?.div(1000) ?: SeekBufferPolicy.DEFAULT_START_MS
        }
        val start = delegate.shouldStartPlayback(parameters) ||
            (fast != null && parameters.bufferedDurationUs >= fast)
        if (start && !parameters.rebuffering) startedOnce = true
        return start
    }
}
