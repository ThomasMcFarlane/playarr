package io.streamarr.shared.data.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * `GET /api/v1/playback/{media_file_id}` response body -- mirrors
 * `PlaybackInfoResponse`/`PlaybackMode`. The server has already decided
 * direct-play vs. transcode by the time this comes back; the client's only
 * job is to branch on [PlaybackInfoResponse.mode] and hand
 * [PlaybackInfoResponse.url] to the platform player (see
 * `io.streamarr.shared.player.StreamFormat`).
 */
@Serializable
enum class PlaybackMode {
    /** [PlaybackInfoResponse.url] is a direct-play source-file URL. */
    @SerialName("direct") Direct,

    /** [PlaybackInfoResponse.url] is an HLS (`.m3u8`) manifest URL. */
    @SerialName("hls") Hls,
}

@Serializable
data class PlaybackInfoResponse(
    val mode: PlaybackMode,
    val url: String,
)
