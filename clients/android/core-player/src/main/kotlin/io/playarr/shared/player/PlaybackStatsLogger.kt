package io.playarr.shared.player

import android.os.Handler
import android.util.Log
import androidx.media3.common.Format
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.exoplayer.DecoderReuseEvaluation
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.analytics.AnalyticsListener
import androidx.media3.exoplayer.source.LoadEventInfo
import androidx.media3.exoplayer.source.MediaLoadData

/**
 * Counts rebuffering the way a viewer perceives it: a move into
 * `STATE_BUFFERING` after playback first became ready, unless a seek caused
 * it. Pure and clock-injected so it is unit-testable off-device.
 */
internal class RebufferTracker {
    var count = 0
        private set
    private var totalMs = 0L
    private var startedAtMs = -1L
    private var everReady = false
    private var seekPending = false

    fun onSeek() {
        seekPending = true
    }

    /**
     * A different media item is about to be prepared (first item, autoplay
     * next, replace): its initial buffering is a start, never a rebuffer, so
     * forget that anything was ever ready. Any stall in progress is closed.
     */
    fun onNewItem(nowMs: Long) {
        if (startedAtMs >= 0) {
            totalMs += nowMs - startedAtMs
            startedAtMs = -1
        }
        everReady = false
        seekPending = false
    }

    fun onState(state: Int, nowMs: Long) {
        when (state) {
            Player.STATE_BUFFERING -> if (everReady && !seekPending && startedAtMs < 0) {
                count++
                startedAtMs = nowMs
            }
            else -> {
                if (startedAtMs >= 0) {
                    totalMs += nowMs - startedAtMs
                    startedAtMs = -1
                }
                if (state == Player.STATE_READY) {
                    everReady = true
                    seekPending = false
                }
            }
        }
    }

    /** Includes the stall still in progress, so periodic lines stay current. */
    fun totalMs(nowMs: Long): Long = totalMs + if (startedAtMs >= 0) nowMs - startedAtMs else 0L
}

/** Snapshot rendered into the stable key=value `PlayarrPlaybackStats` line. */
internal data class PlaybackStatsSnapshot(
    val event: String,
    val state: String,
    val positionMs: Long,
    val bufferedAheadMs: Long,
    val bandwidthBps: Long,
    val rebufferCount: Int,
    val rebufferMs: Long,
    val droppedFrames: Long,
    val decoder: String,
    val videoCodec: String,
    val videoSize: String,
    val videoBitrate: Int,
    val connections: Int,
    val seekCount: Int = 0,
    val bytesLoaded: Long = 0,
    val bitrateSource: String = "unknown",
    val bandwidthSource: String = "meter",
) {
    fun toLogLine(): String = "event=$event state=$state position_ms=$positionMs " +
        "buffered_ahead_ms=$bufferedAheadMs bandwidth_bps=$bandwidthBps " +
        "rebuffer_count=$rebufferCount rebuffer_ms=$rebufferMs dropped_frames=$droppedFrames " +
        "decoder=$decoder video_codec=$videoCodec video_size=$videoSize " +
        "video_bitrate=$videoBitrate connections=$connections " +
        "seek_count=$seekCount bytes_loaded=$bytesLoaded " +
        "bitrate_source=$bitrateSource bandwidth_source=$bandwidthSource"
}

/**
 * Tracks seeks for the `seek` / `seek_ready` telemetry lines. Pure and
 * clock-injected. A new seek before READY restarts the timer: the viewer waits
 * from the last scrub position, and only one `seek_ready` is emitted.
 */
internal class SeekTracker {
    var count = 0
        private set
    private var pendingToMs = 0L
    private var pendingSinceMs = -1L

    fun onSeek(toMs: Long, nowMs: Long) {
        count++
        pendingToMs = toMs
        pendingSinceMs = nowMs
    }

    /** Returns `(toMs, seekToReadyMs)` the first time READY follows a seek, else null. */
    fun onReady(nowMs: Long): Pair<Long, Long>? {
        if (pendingSinceMs < 0) return null
        val result = pendingToMs to (nowMs - pendingSinceMs)
        pendingSinceMs = -1
        return result
    }
}

/**
 * Lightweight playback telemetry for validating direct-play smoothness from
 * logcat (`adb logcat -s PlayarrPlaybackStats`). Logs at INFO in every build
 * type, once on each state change and every [INTERVAL_MS] while playing.
 * The key=value layout of [PlaybackStatsSnapshot.toLogLine] is a stable
 * contract: append keys, never rename or reorder.
 */
internal class PlaybackStatsLogger(
    private val player: ExoPlayer,
    private val handler: Handler = Handler(player.applicationLooper),
    private val clock: () -> Long = android.os.SystemClock::elapsedRealtime,
    private val connections: () -> Int = { ParallelRangeDataSource.activeConnections },
    private val transfers: TransferStats = TransferStats.shared,
    private val sink: (String) -> Unit = { Log.i(TAG, it) },
) : AnalyticsListener {

    private val rebuffer = RebufferTracker()
    private val seeks = SeekTracker()
    private var completedLoadBytes = 0L
    private var meterBps = 0L
    private var droppedFrames = 0L
    private var decoder = "none"
    private var videoCodec = "none"
    private var videoSize = "0x0"
    private var videoBitrate = -1
    private var videoMime: String? = null
    private var audioMime: String? = null
    private var audioChannels = 0
    private var audioPassthrough: Boolean? = null
    private var decoderKind = DecoderKind.Unknown
    private var ticking = false

    /** Measured playback values for the playback health screen; safe to call from the main thread. */
    fun diagnostics(): PlaybackDiagnostics {
        val parts = videoSize.split('x')
        val ownBps = transfers.throughputBps()
        return PlaybackDiagnostics(
            videoCodec = DiagnosticNames.videoCodec(videoMime),
            decoderName = decoder.takeUnless { it == "none" },
            decoderKind = decoderKind,
            width = parts.getOrNull(0)?.toIntOrNull() ?: 0,
            height = parts.getOrNull(1)?.toIntOrNull() ?: 0,
            droppedFrames = droppedFrames,
            rebufferCount = rebuffer.count,
            rebufferMs = rebuffer.totalMs(clock()),
            throughputBps = if (ownBps > 0) ownBps else meterBps,
            audioCodec = DiagnosticNames.audioCodec(audioMime),
            audioChannels = audioChannels,
            audioPassthrough = audioPassthrough,
        )
    }

    private val tick = object : Runnable {
        override fun run() {
            emit("tick")
            if (player.isPlaying) handler.postDelayed(this, INTERVAL_MS) else ticking = false
        }
    }

    override fun onPlaybackStateChanged(eventTime: AnalyticsListener.EventTime, state: Int) {
        val now = clock()
        rebuffer.onState(state, now)
        emit("state")
        if (state == Player.STATE_READY) {
            seeks.onReady(now)?.let { (toMs, latencyMs) ->
                sink(
                    "event=seek_ready to_ms=$toMs seek_to_ready_ms=$latencyMs " +
                        "buffered_ahead_ms=${player.totalBufferedDuration} connections=${connections()} " +
                        "seek_count=${seeks.count} bytes_loaded=$bytesLoaded " +
                        "seek_start_threshold_ms=${SeekStartTelemetry.thresholdMs}",
                )
            }
        }
    }

    override fun onIsPlayingChanged(eventTime: AnalyticsListener.EventTime, isPlaying: Boolean) {
        emit("playing")
        if (isPlaying && !ticking) {
            ticking = true
            handler.postDelayed(tick, INTERVAL_MS)
        }
    }

    override fun onPositionDiscontinuity(
        eventTime: AnalyticsListener.EventTime,
        oldPosition: Player.PositionInfo,
        newPosition: Player.PositionInfo,
        reason: Int,
    ) {
        if (reason == Player.DISCONTINUITY_REASON_SEEK || reason == Player.DISCONTINUITY_REASON_SEEK_ADJUSTMENT) {
            rebuffer.onSeek()
        }
        if (reason == Player.DISCONTINUITY_REASON_SEEK) {
            seeks.onSeek(newPosition.positionMs, clock())
            SeekStartTelemetry.thresholdMs = -1
            sink(
                "event=seek from_ms=${oldPosition.positionMs} to_ms=${newPosition.positionMs} " +
                    "seek_count=${seeks.count} bytes_loaded=$bytesLoaded",
            )
        }
    }

    override fun onLoadCompleted(
        eventTime: AnalyticsListener.EventTime,
        loadEventInfo: LoadEventInfo,
        mediaLoadData: MediaLoadData,
    ) {
        completedLoadBytes += loadEventInfo.bytesLoaded
    }

    /**
     * `onLoadCompleted` never fires for the one long progressive load of a
     * direct-play file, so bytes come from the data source's own counter of
     * everything received (all chunks, including abandoned ones). The
     * completed-load total is only the fallback when nothing went through it
     * (HLS segments, plain single-connection path).
     */
    private val bytesLoaded: Long
        get() = transfers.totalBytes().takeIf { it > 0 } ?: completedLoadBytes

    override fun onBandwidthEstimate(
        eventTime: AnalyticsListener.EventTime,
        totalLoadTimeMs: Int,
        totalBytesLoaded: Long,
        bitrateEstimate: Long,
    ) {
        meterBps = bitrateEstimate
    }

    override fun onDroppedVideoFrames(eventTime: AnalyticsListener.EventTime, droppedFrames: Int, elapsedMs: Long) {
        this.droppedFrames += droppedFrames
    }

    override fun onVideoDecoderInitialized(
        eventTime: AnalyticsListener.EventTime,
        decoderName: String,
        initializedTimestampMs: Long,
        initializationDurationMs: Long,
    ) {
        decoder = decoderName
        decoderKind = DiagnosticNames.lookupDecoderKind(decoderName)
    }

    override fun onAudioInputFormatChanged(
        eventTime: AnalyticsListener.EventTime,
        format: Format,
        decoderReuseEvaluation: DecoderReuseEvaluation?,
    ) {
        audioMime = format.sampleMimeType
        audioChannels = format.channelCount.takeIf { it > 0 } ?: 0
    }

    override fun onAudioTrackInitialized(
        eventTime: AnalyticsListener.EventTime,
        audioTrackConfig: androidx.media3.exoplayer.audio.AudioSink.AudioTrackConfig,
    ) {
        audioPassthrough = DiagnosticNames.isPassthroughEncoding(audioTrackConfig.encoding)
    }

    override fun onVideoInputFormatChanged(
        eventTime: AnalyticsListener.EventTime,
        format: Format,
        decoderReuseEvaluation: DecoderReuseEvaluation?,
    ) {
        videoMime = format.sampleMimeType
        videoCodec = format.codecs ?: format.sampleMimeType ?: "unknown"
        videoSize = "${format.width}x${format.height}"
        videoBitrate = StreamBitrate.declaredBps(format).takeIf { it > 0 }?.toInt() ?: -1
    }

    override fun onPlayerError(eventTime: AnalyticsListener.EventTime, error: PlaybackException) {
        emit("error")
    }

    override fun onSurfaceSizeChanged(eventTime: AnalyticsListener.EventTime, width: Int, height: Int) {
        sink(surfaceLine(width, height, stateName(player.playbackState), player.currentPosition, player.totalBufferedDuration))
    }

    /**
     * Logged immediately before the player is (re)prepared, so a buffer drop
     * to zero can be attributed. Reads the pre-prepare buffer and position.
     */
    fun logReprepare(reason: String) {
        if (reason == "first_item" || reason.startsWith("replace_item")) rebuffer.onNewItem(clock())
        sink(reprepareLine(reason, stateName(player.playbackState), player.currentPosition, player.totalBufferedDuration))
    }

    private fun emit(event: String) {
        val now = clock()
        val bitrate = StreamBitrate.resolve(videoBitrate.coerceAtLeast(0).toLong(), transfers.derivedBitrateBps())
        val ownBps = transfers.throughputBps()
        sink(
            PlaybackStatsSnapshot(
                event = event,
                state = stateName(player.playbackState),
                positionMs = player.currentPosition,
                bufferedAheadMs = player.totalBufferedDuration,
                bandwidthBps = if (ownBps > 0) ownBps else meterBps,
                rebufferCount = rebuffer.count,
                rebufferMs = rebuffer.totalMs(now),
                droppedFrames = droppedFrames,
                decoder = decoder,
                videoCodec = videoCodec,
                videoSize = videoSize,
                videoBitrate = if (bitrate.bps > 0) bitrate.bps.coerceAtMost(Int.MAX_VALUE.toLong()).toInt() else -1,
                connections = connections(),
                seekCount = seeks.count,
                bytesLoaded = bytesLoaded,
                bitrateSource = bitrate.source.label,
                bandwidthSource = if (ownBps > 0) "transfer" else "meter",
            ).toLogLine(),
        )
    }

    private fun stateName(state: Int) = when (state) {
        Player.STATE_IDLE -> "idle"
        Player.STATE_BUFFERING -> "buffering"
        Player.STATE_READY -> "ready"
        Player.STATE_ENDED -> "ended"
        else -> "unknown"
    }

    companion object {
        const val TAG = "PlayarrPlaybackStats"
        const val INTERVAL_MS = 5_000L

        internal fun reprepareLine(reason: String, state: String, positionMs: Long, bufferedAheadMs: Long) =
            "event=reprepare reason=$reason state=$state position_ms=$positionMs buffered_ahead_ms=$bufferedAheadMs"

        /** A 0x0 surface means the video surface was detached; Media3 keeps the buffer across a swap. */
        internal fun surfaceLine(width: Int, height: Int, state: String, positionMs: Long, bufferedAheadMs: Long) =
            "event=surface width=$width height=$height attached=${width > 0 && height > 0} " +
                "state=$state position_ms=$positionMs buffered_ahead_ms=$bufferedAheadMs"
    }
}
