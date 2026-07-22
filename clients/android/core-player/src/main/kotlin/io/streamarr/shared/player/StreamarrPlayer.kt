package io.streamarr.shared.player

import androidx.media3.common.Player
import kotlinx.coroutines.flow.StateFlow

/**
 * Which container/transport [StreamarrPlayer.prepare]'s `mediaUrl` is,
 * mirroring `io.streamarr.shared.data.model.PlaybackMode` (the real
 * `GET /api/v1/playback/{media_file_id}` response's `mode` field) without
 * this module depending on `core-data` -- see `core-data`'s
 * `StreamarrHttpClient` KDoc for the same module-independence rationale
 * applied here. Callers map the server's decision onto this before calling
 * [StreamarrPlayer.prepare].
 */
enum class StreamFormat {
    /** A direct-play/direct-stream source-file URL; Media3 infers container from the URL/response headers. */
    Direct,

    /** An HLS (`.m3u8`) manifest URL; forced explicitly (see [ExoPlayerStreamarrPlayer]) rather than URL-sniffed. */
    Hls,
}

data class StreamarrSubtitleTrack(
    val id: String,
    val url: String,
    val label: String,
    val language: String?,
    val isDefault: Boolean,
    val forced: Boolean,
)

/**
 * Thin wrapper interface around Media3/ExoPlayer that the universal Android
 * application drives to play whatever
 * `GET /api/v1/playback/{media_file_id}` resolved. Kept as an interface
 * (rather than exposing [androidx.media3.exoplayer.ExoPlayer] directly) so:
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
     * Loads and begins buffering [mediaUrl], seeking to [startPositionMs]
     * (resume position) before playback starts. [format] is the real
     * direct-play-vs-transcode decision branch: [StreamFormat.Hls] forces
     * Media3's HLS extractor regardless of what [mediaUrl] looks like
     * (some `on-demand` transcode session URLs don't end in `.m3u8`),
     * while [StreamFormat.Direct] lets Media3 infer the container itself.
     */
    fun prepare(
        mediaUrl: String,
        format: StreamFormat = StreamFormat.Direct,
        startPositionMs: Long = 0L,
        subtitles: List<StreamarrSubtitleTrack> = emptyList(),
        selectedSubtitleId: String? = null,
        preferredAudioLanguage: String? = null,
        preferredSubtitleLanguage: String? = null,
    )

    fun play()
    fun pause()
    fun seekTo(positionMs: Long)
    fun setPlaybackSpeed(speed: Float)

    /** Releases the underlying player. Must be called from the owning screen's lifecycle teardown. */
    fun release()
}
