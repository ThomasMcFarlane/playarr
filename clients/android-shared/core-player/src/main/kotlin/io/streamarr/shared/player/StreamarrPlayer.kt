package io.streamarr.shared.player

import androidx.media3.common.Player
import kotlinx.coroutines.flow.StateFlow

/**
 * Thin wrapper interface around Media3/ExoPlayer that `mobile-android` and
 * `tv-android` both drive to play a
 * [io.streamarr.shared.data.model.MediaFile] or
 * [io.streamarr.shared.data.model.Rendition]. Kept as an interface (rather
 * than exposing [androidx.media3.exoplayer.ExoPlayer] directly) so:
 *
 * - Both apps get identical playback semantics without duplicating
 *   ExoPlayer configuration (track selection, buffering policy, error
 *   mapping) in two places.
 * - Screens depend on the small [PlaybackState] shape in `state` rather
 *   than polling `Player.getCurrentPosition()` etc. directly, which keeps
 *   Compose recomposition scoped to what actually changed.
 * - A test double can stand in for ExoPlayer in unit tests without an
 *   Android runtime.
 *
 * [rawPlayer] is still exposed for the one thing this interface doesn't
 * abstract over -- attaching to a `PlayerView`/`androidx.media3.ui.PlayerView`
 * (mobile) or a TV-specific surface, which need the real [Player] instance.
 */
interface StreamarrPlayer {

    /** Current playback state; collect this to drive UI. */
    val state: StateFlow<PlaybackState>

    /** The underlying Media3 [Player], for attaching a `PlayerView`. Do not call mutating methods on it directly. */
    val rawPlayer: Player

    /**
     * Loads and begins buffering [mediaUrl] (a direct-play source URL or an
     * HLS/DASH manifest URL for a [io.streamarr.shared.data.model.Rendition]),
     * seeking to [startPositionMs] (resume position) before playback starts.
     */
    fun prepare(mediaUrl: String, startPositionMs: Long = 0L)

    fun play()
    fun pause()
    fun seekTo(positionMs: Long)
    fun setPlaybackSpeed(speed: Float)

    /** Releases the underlying player. Must be called from the owning screen's lifecycle teardown. */
    fun release()
}
