package io.playarr.shared.player

import android.app.ActivityManager
import android.content.Context
import android.content.pm.ApplicationInfo
import android.net.Uri
import android.util.Log
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.PlaybackException
import androidx.media3.common.PlaybackParameters
import androidx.media3.common.Player
import androidx.media3.common.Tracks
import androidx.media3.common.TrackSelectionOverride
import androidx.media3.datasource.DataSource
import androidx.media3.datasource.HttpDataSource
import androidx.media3.exoplayer.DefaultLoadControl
import androidx.media3.exoplayer.LoadControl
import androidx.media3.exoplayer.upstream.DefaultBandwidthMeter
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.mediacodec.MediaCodecDecoderException
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.extractor.DefaultExtractorsFactory
import java.util.concurrent.atomic.AtomicBoolean
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import okhttp3.OkHttpClient

/**
 * Default [PlayarrPlayer], backed by a real [ExoPlayer] instance.
 *
 * Not constructed via `@Inject` here: it needs an [android.content.Context]
 * and this module deliberately stays framework-DI-agnostic (see
 * `core-data`'s `PlayarrHttpClient` for the same reasoning). The app
 * modules' Hilt `@Module`s call [create] from a `@Provides` function bound
 * to `@ApplicationContext`.
 */
class ExoPlayerPlayarrPlayer private constructor(
    override val rawPlayer: ExoPlayer,
    private val parallelRangeEnabled: AtomicBoolean,
    private val decoderBlocklist: DecoderBlocklist = DecoderBlocklist(),
) : PlayarrPlayer {

    private val statsLogger = PlaybackStatsLogger(rawPlayer)
    private var decoderRetries = 0
    private var audioPolicyApplied = false
    private var preferredAudioLanguage: String? = null

    override fun diagnostics(): PlaybackDiagnostics = statsLogger.diagnostics()

    private val _state = MutableStateFlow(PlaybackState())
    override val state: StateFlow<PlaybackState> = _state.asStateFlow()

    init {
        rawPlayer.addAnalyticsListener(statsLogger)
        if (DiscardingVideoRenderer.isRequested()) {
            rawPlayer.addAnalyticsListener(androidx.media3.exoplayer.util.EventLogger())
        }
        rawPlayer.addListener(object : Player.Listener {
            override fun onIsPlayingChanged(isPlaying: Boolean) {
                _state.update { it.copy(isPlaying = isPlaying) }
            }

            override fun onTimelineChanged(timeline: androidx.media3.common.Timeline, reason: Int) = syncStreamStats()

            override fun onMediaItemTransition(mediaItem: androidx.media3.common.MediaItem?, reason: Int) =
                syncStreamStats()

            override fun onPlayWhenReadyChanged(playWhenReady: Boolean, reason: Int) {
                _state.update { it.copy(playWhenReady = playWhenReady) }
            }

            override fun onPlaybackStateChanged(playbackState: Int) {
                syncStreamStats()
                _state.update {
                    it.copy(
                        isBuffering = playbackState == Player.STATE_BUFFERING,
                        hasEnded = playbackState == Player.STATE_ENDED,
                        durationMs = rawPlayer.duration.coerceAtLeast(0L),
                    )
                }
            }

            override fun onTracksChanged(tracks: Tracks) {
                applyAudioPolicy(tracks)
            }

            override fun onPlayerError(error: PlaybackException) {
                if (retryWithAnotherDecoder(error)) return
                val httpError = generateSequence<Throwable>(error) { it.cause }
                    .filterIsInstance<HttpDataSource.InvalidResponseCodeException>()
                    .firstOrNull()
                _state.update {
                    it.copy(
                        error = PlaybackError(
                            message = error.errorCodeName,
                            isRetryable = error.errorCode in RETRYABLE_ERROR_CODES,
                            httpStatus = httpError?.responseCode,
                            requestUri = httpError?.dataSpec?.uri?.toString(),
                        ),
                    )
                }
            }

            override fun onPlaybackParametersChanged(playbackParameters: PlaybackParameters) {
                _state.update { it.copy(playbackSpeed = playbackParameters.speed) }
            }
        })
    }

    /**
     * Runs once per prepared item, on the first track report that has audio.
     * If the main track is undecodable, steers away from commentary tracks
     * (see [AudioTrackPolicy]); later user choices are never overridden.
     */
    /** Pairs the current item's URI with its duration so a bitrate can be derived from content length. */
    private fun syncStreamStats() {
        val uri = rawPlayer.currentMediaItem?.localConfiguration?.uri?.toString()
        TransferStats.shared.setCurrentStream(uri, rawPlayer.duration.takeIf { it != C.TIME_UNSET } ?: -1L)
    }

    private fun applyAudioPolicy(tracks: Tracks) {
        if (audioPolicyApplied) return
        val audioGroups = tracks.groups.withIndex().filter { it.value.type == C.TRACK_TYPE_AUDIO }
        if (audioGroups.isEmpty()) return
        audioPolicyApplied = true
        val candidates = audioGroups.flatMap { (groupIndex, group) ->
            (0 until group.length).map { trackIndex ->
                val format = group.getTrackFormat(trackIndex)
                AudioCandidate(
                    groupIndex = groupIndex,
                    trackIndex = trackIndex,
                    language = format.language,
                    channelCount = format.channelCount.takeIf { it != androidx.media3.common.Format.NO_VALUE } ?: 0,
                    isSupported = group.isTrackSupported(trackIndex),
                    isDefault = format.selectionFlags and C.SELECTION_FLAG_DEFAULT != 0,
                    isCommentary = AudioTrackPolicy.isCommentary(format.roleFlags, format.label),
                )
            }
        }
        val choice = AudioTrackPolicy.choose(candidates, preferredAudioLanguage) as? AudioChoice.Override ?: return
        val pick = choice.candidate
        val group = tracks.groups[pick.groupIndex]
        val alreadySelected = group.isTrackSelected(pick.trackIndex)
        if (!alreadySelected) {
            rawPlayer.trackSelectionParameters = rawPlayer.trackSelectionParameters.buildUpon()
                .setOverrideForType(TrackSelectionOverride(group.mediaTrackGroup, pick.trackIndex))
                .build()
        }
        if (choice.onlyCommentary) {
            // No notice UI pattern exists in the app yet, so this is logged
            // and exposed on PlaybackState for screens that want to show it.
            Log.w(TAG, "main audio track is not decodable; only commentary tracks are, playing commentary")
            _state.update { it.copy(audioNotice = AudioNotice.OnlyCommentaryDecodable) }
        } else {
            Log.i(TAG, "main audio track is not decodable; using track ${pick.groupIndex}:${pick.trackIndex}")
        }
    }

    /**
     * A decoder that fails mid-stream is blocked and playback restarted at
     * the same position so the next decoder for the codec (e.g. the software
     * one) is used. Bounded, so a stream no decoder can handle still
     * surfaces its error.
     */
    private fun retryWithAnotherDecoder(error: PlaybackException): Boolean {
        if (error.errorCode != PlaybackException.ERROR_CODE_DECODING_FAILED || decoderRetries >= MAX_DECODER_RETRIES) {
            return false
        }
        val decoder = generateSequence<Throwable>(error) { it.cause }
            .filterIsInstance<MediaCodecDecoderException>()
            .firstOrNull()
            ?.codecInfo
            ?.name
            ?: return false
        if (!decoderBlocklist.block(decoder)) return false
        decoderRetries++
        Log.w(TAG, "decoder $decoder failed, retrying with another decoder: ${error.message}")
        statsLogger.logReprepare("decoder_retry decoder=$decoder")
        rawPlayer.prepare()
        return true
    }

    override fun prepare(
        mediaUrl: String,
        format: StreamFormat,
        startPositionMs: Long,
        subtitles: List<PlayarrSubtitleTrack>,
        selectedSubtitleId: String?,
        preferredAudioLanguage: String?,
        preferredSubtitleLanguage: String?,
    ) {
        _state.update { PlaybackState() }
        decoderRetries = 0
        audioPolicyApplied = false
        this.preferredAudioLanguage = preferredAudioLanguage
        // Only the direct-play progressive stream benefits from parallel
        // ranges; HLS segments are small and already fetched per segment.
        parallelRangeEnabled.set(format == StreamFormat.Direct)
        rawPlayer.trackSelectionParameters = rawPlayer.trackSelectionParameters
            .buildUpon()
            .setTrackTypeDisabled(C.TRACK_TYPE_TEXT, selectedSubtitleId == null)
            .setPreferredAudioLanguage(preferredAudioLanguage)
            .setPreferredTextLanguage(preferredSubtitleLanguage)
            .build()
        val mediaItem = MediaItem.Builder()
            .setUri(mediaUrl)
            .setSubtitleConfigurations(
                subtitles.map { subtitle ->
                    MediaItem.SubtitleConfiguration.Builder(Uri.parse(subtitle.url))
                        .setId(subtitle.id)
                        .setLabel(subtitle.label)
                        .setLanguage(subtitle.language)
                        .setMimeType(MimeTypes.TEXT_VTT)
                        .setSelectionFlags(
                            (if (subtitle.isDefault || subtitle.id == selectedSubtitleId) C.SELECTION_FLAG_DEFAULT else 0) or
                                (if (subtitle.forced) C.SELECTION_FLAG_FORCED else 0),
                        )
                        .build()
                },
            )
            .apply {
                // Forces Media3's HLS extractor for on-demand transcode
                // session URLs, which don't necessarily end in `.m3u8`
                // (see `PlaybackInfoResponse.url`'s KDoc) -- without this,
                // Media3 falls back to sniffing the URL/response
                // Content-Type, which isn't reliable for those.
                if (format == StreamFormat.Hls) setMimeType(MimeTypes.APPLICATION_M3U8)
            }
            .build()
        statsLogger.logReprepare(
            if (rawPlayer.currentMediaItem == null) "first_item" else "replace_item start_ms=$startPositionMs",
        )
        rawPlayer.setMediaItem(mediaItem, startPositionMs)
        rawPlayer.prepare()
    }

    override fun play() {
        rawPlayer.play()
        _state.update { it.copy(playWhenReady = true) }
    }

    override fun pause() {
        rawPlayer.pause()
        _state.update { it.copy(playWhenReady = false) }
    }

    override fun seekTo(positionMs: Long) {
        rawPlayer.seekTo(positionMs)
        _state.update { it.copy(positionMs = positionMs) }
    }

    override fun setPlaybackSpeed(speed: Float) {
        rawPlayer.playbackParameters = PlaybackParameters(speed)
    }

    override fun selectSubtitleTrack(trackId: String?) {
        val parameters = rawPlayer.trackSelectionParameters.buildUpon()
            .clearOverridesOfType(C.TRACK_TYPE_TEXT)
            .setTrackTypeDisabled(C.TRACK_TYPE_TEXT, trackId == null)
        if (trackId != null) {
            rawPlayer.currentTracks.groups
                .asSequence()
                .filter { it.type == C.TRACK_TYPE_TEXT }
                .mapNotNull { group ->
                    (0 until group.length)
                        .firstOrNull { index -> group.getTrackFormat(index).id == trackId }
                        ?.let { index -> TrackSelectionOverride(group.mediaTrackGroup, index) }
                }
                .firstOrNull()
                ?.let(parameters::setOverrideForType)
        }
        rawPlayer.trackSelectionParameters = parameters.build()
    }

    override fun release() {
        rawPlayer.release()
    }

    companion object {
        /**
         * Errors ExoPlayer itself may recover from on retry (transient
         * network/IO faults) as opposed to ones that won't change on a
         * second attempt (unsupported format, DRM failure).
         */
        private val RETRYABLE_ERROR_CODES = setOf(
            PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_FAILED,
            PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_TIMEOUT,
            PlaybackException.ERROR_CODE_IO_BAD_HTTP_STATUS,
            PlaybackException.ERROR_CODE_TIMEOUT,
        )

        /**
         * [parallelHttpClient], when given, enables [ParallelRangeDataSource]
         * for direct-play HTTP items; [dataSourceFactory] stays the plain
         * single-connection path used for everything else (HLS, subtitles,
         * and as the fallback when a server cannot serve ranges). The client
         * should be HTTP/1.1-only so each chunk gets its own TCP flow.
         */
        fun create(
            context: Context,
            dataSourceFactory: DataSource.Factory? = null,
            parallelHttpClient: OkHttpClient? = null,
        ): ExoPlayerPlayarrPlayer {
            val appContext = context.applicationContext
            val parallelEnabled = AtomicBoolean(false)
            val effectiveFactory = if (dataSourceFactory != null && parallelHttpClient != null) {
                ParallelRangeDataSource.Factory(
                    client = parallelHttpClient,
                    fallbackFactory = dataSourceFactory,
                    isEnabled = parallelEnabled::get,
                )
            } else {
                dataSourceFactory
            }
            val decoderBlocklist = DecoderBlocklist()
            val extractorsFactory = DolbyVisionFallbackExtractorsFactory(DefaultExtractorsFactory())
            val builder = ExoPlayer.Builder(
                appContext,
                // Fall back to another decoder for the same codec when the
                // preferred one rejects the stream (e.g. a hardware HEVC
                // decoder without Main10 support), so 4K HDR still plays.
                PlayarrRenderersFactory(appContext, discardVideo = DiscardingVideoRenderer.isRequested())
                    .setEnableDecoderFallback(true)
                    .setMediaCodecSelector(decoderBlocklist.selector()),
            ).setLoadControl(buildLoadControl(appContext))
            builder.setMediaSourceFactory(
                if (effectiveFactory != null) {
                    DefaultMediaSourceFactory(effectiveFactory, extractorsFactory)
                } else {
                    DefaultMediaSourceFactory(appContext, extractorsFactory)
                },
            )
            return ExoPlayerPlayarrPlayer(builder.build(), parallelEnabled, decoderBlocklist)
        }

        /**
         * Buffer sizing for high-bitrate (4K remux, ~60+ Mbps) direct play
         * over a high-latency link. Time thresholds: 30 s min / 120 s max
         * gives headroom for bitrate peaks and brief throughput dips. Start
         * after 10 s and resume after 15 s: a 4K remux over a ~10 MB/s link
         * downloads only ~1.3x faster than it plays, so a 2.5 s start left a
         * 2-3 s cushion that every bitrate peak drained, stalling every
         * ~20 s; a deeper initial buffer costs a few seconds once and then
         * rides the peaks out.
         *
         * The byte cap is 40% of the app's heap class (large class when the
         * manifest sets `largeHeap`), clamped to 48-256 MiB: Media3 buffers
         * on the Java heap, and TV devices have small ones. Time is not
         * prioritised over size here on purpose: that would let the buffer
         * ignore the cap until 30 s is queued, which is ~230 MB at 62 Mbps
         * and would OOM a TV. On big heaps the cap still holds well over
         * 30 s of typical content; on small ones it degrades to fewer
         * seconds rather than crashing.
         */
        internal fun buildLoadControl(context: Context): LoadControl {
            val activityManager = context.getSystemService(Context.ACTIVITY_SERVICE) as? ActivityManager
            val largeHeap = context.applicationInfo.flags and ApplicationInfo.FLAG_LARGE_HEAP != 0
            val heapClassMb = when {
                activityManager == null -> DEFAULT_HEAP_CLASS_MB
                largeHeap -> activityManager.largeMemoryClass
                else -> activityManager.memoryClass
            }
            val meter = DefaultBandwidthMeter.getSingletonInstance(context)
            return AdaptiveLoadControl(
                delegate = buildDefaultLoadControl(heapClassMb),
                backBufferBudgetBytes = backBufferBudgetBytes(heapClassMb),
                // Own aggregate rate first: the meter sees one sequential transfer
                // and under-reports parallel range downloads (see TransferStats).
                throughputBps = { TransferStats.shared.throughputBps().takeIf { it > 0 } ?: meter.bitrateEstimate },
                derivedBitrateBps = { TransferStats.shared.derivedBitrateBps() },
            )
        }

        internal fun buildDefaultLoadControl(heapClassMb: Int): DefaultLoadControl {
            return DefaultLoadControl.Builder()
                .setBufferDurationsMs(
                    MIN_BUFFER_MS,
                    MAX_BUFFER_MS,
                    BUFFER_FOR_PLAYBACK_MS,
                    BUFFER_FOR_REBUFFER_MS,
                )
                .setTargetBufferBytes(targetBufferBytes(heapClassMb))
                .setPrioritizeTimeOverSizeThresholds(false)
                .build()
        }

        /**
         * Media3 discards played data immediately unless a back buffer is
         * configured, so every backward scrub refetched from the network (the
         * data source keeps no cache). [AdaptiveLoadControl] retains up to
         * 30 s from a keyframe, but the retained bytes share the allocator
         * the heap cap applies to, so they are budgeted to a third of the cap:
         * ~30 s for ordinary content, shorter for 4K remuxes, leaving the rest
         * for the forward buffer.
         */
        internal fun backBufferBudgetBytes(heapClassMb: Int): Long =
            targetBufferBytes(heapClassMb).toLong() / BACK_BUFFER_CAP_DIVISOR

        internal fun targetBufferBytes(heapClassMb: Int): Int =
            (heapClassMb.toLong() * MB * HEAP_FRACTION_PERCENT / 100)
                .coerceIn(MIN_TARGET_BYTES, MAX_TARGET_BYTES)
                .toInt()

        private const val TAG = "ExoPlayerPlayarrPlayer"
        private const val MAX_DECODER_RETRIES = 3
        private const val MB = 1024L * 1024L
        private const val DEFAULT_HEAP_CLASS_MB = 128
        private const val HEAP_FRACTION_PERCENT = 40
        private const val MIN_TARGET_BYTES = 48 * MB
        private const val MAX_TARGET_BYTES = 256 * MB
        private const val MIN_BUFFER_MS = 30_000
        private const val MAX_BUFFER_MS = 120_000
        private const val BUFFER_FOR_PLAYBACK_MS = 10_000
        private const val BUFFER_FOR_REBUFFER_MS = 15_000
        private const val BACK_BUFFER_CAP_DIVISOR = 3
    }
}
