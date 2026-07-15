package io.streamarr.shared.player

import android.content.Context
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.PlaybackException
import androidx.media3.common.PlaybackParameters
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
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

            override fun onPlaybackStateChanged(playbackState: Int) {
                _state.update {
                    it.copy(
                        isBuffering = playbackState == Player.STATE_BUFFERING,
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

    override fun prepare(mediaUrl: String, format: StreamFormat, startPositionMs: Long) {
        _state.update { PlaybackState() }
        val mediaItem = MediaItem.Builder()
            .setUri(mediaUrl)
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
    }

    override fun pause() {
        rawPlayer.pause()
    }

    override fun seekTo(positionMs: Long) {
        rawPlayer.seekTo(positionMs)
        _state.update { it.copy(positionMs = positionMs) }
    }

    override fun setPlaybackSpeed(speed: Float) {
        rawPlayer.playbackParameters = PlaybackParameters(speed)
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

        fun create(context: Context): ExoPlayerStreamarrPlayer =
            ExoPlayerStreamarrPlayer(ExoPlayer.Builder(context.applicationContext).build())
    }
}
