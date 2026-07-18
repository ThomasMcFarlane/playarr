package io.streamarr.shared.player

/** Snapshot of playback state, observed via [StreamarrPlayer.state]. */
data class PlaybackState(
    val isPlaying: Boolean = false,
    val isBuffering: Boolean = false,
    val positionMs: Long = 0L,
    val durationMs: Long = 0L,
    val bufferedPercentage: Int = 0,
    /** `1.0` is normal speed; mirrors `androidx.media3.common.PlaybackParameters.speed`. */
    val playbackSpeed: Float = 1f,
    /** Non-null once playback has failed; UI should surface this and offer a retry. */
    val error: PlaybackError? = null,
)

/**
 * A playback failure, narrowed to what UI needs to decide what to show and
 * whether retrying makes sense -- deliberately not just "the ExoPlaybackException",
 * so Android screens don't need a Media3 import just
 * to render an error state.
 */
data class PlaybackError(
    val message: String,
    val isRetryable: Boolean,
)
