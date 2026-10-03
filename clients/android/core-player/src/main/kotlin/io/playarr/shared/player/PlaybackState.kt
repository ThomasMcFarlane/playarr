package io.playarr.shared.player

/** Snapshot of playback state, observed via [PlayarrPlayer.state]. */
data class PlaybackState(
    val isPlaying: Boolean = false,
    /** True while playback is intended to continue, including a buffering interval. */
    val playWhenReady: Boolean = false,
    val isBuffering: Boolean = false,
    val hasEnded: Boolean = false,
    val positionMs: Long = 0L,
    val durationMs: Long = 0L,
    val bufferedPercentage: Int = 0,
    /** `1.0` is normal speed; mirrors `androidx.media3.common.PlaybackParameters.speed`. */
    val playbackSpeed: Float = 1f,
    /** Non-null once playback has failed; UI should surface this and offer a retry. */
    val error: PlaybackError? = null,
    /** Set when audio selection had to compromise; screens may show it. */
    val audioNotice: AudioNotice? = null,
)

enum class AudioNotice {
    /** The main audio track is undecodable here and only commentary tracks are, so one is playing. */
    OnlyCommentaryDecodable,
}

/**
 * A playback failure, narrowed to what UI needs to decide what to show and
 * whether retrying makes sense -- deliberately not just "the ExoPlaybackException",
 * so Android screens don't need a Media3 import just
 * to render an error state.
 */
data class PlaybackError(
    val message: String,
    val isRetryable: Boolean,
    val httpStatus: Int? = null,
    val requestUri: String? = null,
)
