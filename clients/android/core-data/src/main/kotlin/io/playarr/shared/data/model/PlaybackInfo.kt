package io.playarr.shared.data.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * `GET /api/v1/playback/{media_file_id}` response body -- mirrors
 * `PlaybackInfoResponse`/`PlaybackMode`. The server has already decided
 * direct-play vs. transcode by the time this comes back; the client's only
 * job is to branch on [PlaybackInfoResponse.mode] and hand
 * [PlaybackInfoResponse.url] to the platform player (see
 * `io.playarr.shared.player.StreamFormat`).
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
    val sessionId: String? = null,
    val mimeType: String? = null,
    val durationMs: Long = 0L,
    val sourceOffsetMs: Long = 0L,
    val audioTracks: List<PlaybackAudioTrackOption> = emptyList(),
    val selectedAudioTrackId: String? = null,
    val subtitleTracks: List<PlaybackSubtitleTrackOption> = emptyList(),
    val selectedSubtitleTrackId: String? = null,
    val selectedQualityId: String = "original",
    val qualityOptions: List<PlaybackQualityOption> = emptyList(),
)

@Serializable
data class PlaybackQualityOption(
    val id: String,
    val label: String,
    val profile: String? = null,
    val height: Int? = null,
    val videoBitrateBps: Long? = null,
)

@Serializable
data class PlaybackAudioTrackOption(
    val id: String,
    val streamIndex: Int,
    val label: String,
    val language: String? = null,
    val codec: String? = null,
    val channels: Int? = null,
    val isDefault: Boolean = false,
)

@Serializable
data class PlaybackSubtitleTrackOption(
    val id: String,
    val streamIndex: Int,
    val label: String,
    val language: String? = null,
    val codec: String,
    val isDefault: Boolean = false,
    val forced: Boolean = false,
    val url: String,
)

@Serializable
data class PlaybackEventRequest(
    val kind: PlaybackEventKind,
    val positionMs: Long? = null,
    val bytesStreamedTotal: Long? = null,
    val reason: PlaybackStopReason? = null,
    val message: String? = null,
) {
    companion object {
        fun heartbeat(positionMs: Long) = PlaybackEventRequest(
            kind = PlaybackEventKind.Heartbeat,
            positionMs = positionMs,
            bytesStreamedTotal = 0L,
        )
        fun stop(reason: PlaybackStopReason, positionMs: Long) =
            PlaybackEventRequest(PlaybackEventKind.Stop, positionMs = positionMs, reason = reason)
        fun error(message: String) = PlaybackEventRequest(PlaybackEventKind.Error, message = message)
    }
}

@Serializable
enum class PlaybackEventKind {
    @SerialName("heartbeat") Heartbeat,
    @SerialName("stop") Stop,
    @SerialName("error") Error,
}

@Serializable
enum class PlaybackStopReason {
    @SerialName("completed") Completed,
    @SerialName("user_stopped") UserStopped,
    @SerialName("error") Error,
}
