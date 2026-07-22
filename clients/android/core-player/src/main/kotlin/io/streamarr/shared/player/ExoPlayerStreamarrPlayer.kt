package io.streamarr.shared.player

import android.content.Context
import android.net.Uri
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.PlaybackException
import androidx.media3.common.PlaybackParameters
import androidx.media3.common.Player
import androidx.media3.common.TrackSelectionOverride
import androidx.media3.datasource.DataSource
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update

/**
 * Default [StreamarrPlayer], backed by a real [ExoPlayer] instance.
 *
 * Not constructed via `@Inject` here: it needs an [android.content.Context]
 * and this module deliberately stays framework-DI-agnostic (see
 * `core-data`'s `StreamarrHttpClient` for the same reasoning). The app
 * modules' Hilt `@Module`s call [create] from a `@Provides` function bound
 * to `@ApplicationContext`.
 */
class ExoPlayerStreamarrPlayer private constructor(
    override val rawPlayer: ExoPlayer,
) : StreamarrPlayer {

    private val _state = MutableStateFlow(PlaybackState())
    override val state: StateFlow<PlaybackState> = _state.asStateFlow()

    init {
        rawPlayer.addListener(object : Player.Listener {
            override fun onIsPlayingChanged(isPlaying: Boolean) {
                _state.update { it.copy(isPlaying = isPlaying) }
            }

            override fun onPlayWhenReadyChanged(playWhenReady: Boolean, reason: Int) {
                _state.update { it.copy(playWhenReady = playWhenReady) }
            }

            override fun onPlaybackStateChanged(playbackState: Int) {
                _state.update {
                    it.copy(
                        isBuffering = playbackState == Player.STATE_BUFFERING,
                        hasEnded = playbackState == Player.STATE_ENDED,
                        durationMs = rawPlayer.duration.coerceAtLeast(0L),
                    )
                }
            }

            override fun onPlayerError(error: PlaybackException) {
                _state.update {
                    it.copy(
                        error = PlaybackError(
                            message = error.errorCodeName,
                            isRetryable = error.errorCode in RETRYABLE_ERROR_CODES,
                        ),
                    )
                }
            }

            override fun onPlaybackParametersChanged(playbackParameters: PlaybackParameters) {
                _state.update { it.copy(playbackSpeed = playbackParameters.speed) }
            }
        })
    }

    override fun prepare(
        mediaUrl: String,
        format: StreamFormat,
        startPositionMs: Long,
        subtitles: List<StreamarrSubtitleTrack>,
        selectedSubtitleId: String?,
        preferredAudioLanguage: String?,
        preferredSubtitleLanguage: String?,
    ) {
        _state.update { PlaybackState() }
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

        fun create(
            context: Context,
            dataSourceFactory: DataSource.Factory? = null,
        ): ExoPlayerStreamarrPlayer {
            val builder = ExoPlayer.Builder(context.applicationContext)
            if (dataSourceFactory != null) {
                builder.setMediaSourceFactory(DefaultMediaSourceFactory(dataSourceFactory))
            }
            return ExoPlayerStreamarrPlayer(builder.build())
        }
    }
}
