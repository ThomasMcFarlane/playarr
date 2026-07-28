package io.playarr.shared.data.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * Kotlin mirror of `playarr-model::download::DownloadStatus` /
 * `playarr_api::downloads`'s wire DTOs -- server-staged, quality-selectable,
 * resumable downloads of media the caller already has playback access to.
 *
 * `Queued`/`Processing` named-profile tickets never currently transition to
 * `Ready` (see `backend/crates/playarr-api/src/downloads.rs`'s module
 * doc comment: no single-file transcode worker is wired up yet). Original-
 * quality tickets (`quality_id == "original"`) are `Ready` immediately.
 */
@Serializable
enum class DownloadStatus {
    @SerialName("queued") Queued,
    @SerialName("processing") Processing,
    @SerialName("ready") Ready,
    @SerialName("failed") Failed,
    @SerialName("expired") Expired,
    @SerialName("canceled") Canceled,
}

/** `POST /api/v1/downloads` request body -- mirrors `CreateDownloadTicketRequest`. */
@Serializable
data class CreateDownloadTicketRequest(
    val mediaFileId: String,
    /** `"original"`, or a transcode profile name from [DownloadQualityOption.id]. */
    val qualityId: String,
)

/**
 * `POST /api/v1/downloads`/`GET /api/v1/downloads`/`GET /api/v1/downloads/{id}`
 * response body -- mirrors `DownloadTicketResponse`.
 */
@Serializable
data class DownloadTicketResponse(
    val id: String,
    val mediaFileId: String,
    val qualityId: String,
    val status: DownloadStatus,
    val container: String,
    val sizeBytes: Long? = null,
    val requestedAt: String,
    val readyAt: String? = null,
    val expiresAt: String? = null,
    val errorMessage: String? = null,
)

/**
 * `GET /api/v1/media/{media_file_id}/download-options` -- mirrors
 * `DownloadQualityOption`. `"original"` has `sizeIsEstimate == false` and a
 * real byte count ([estimatedSizeBytes] is [MediaFile]'s own `size_bytes`
 * for that option); every named transcode profile is a rough
 * `video_bitrate_bps * duration_ms / 8000` estimate (`sizeIsEstimate == true`)
 * since nothing has actually encoded it yet.
 */
@Serializable
data class DownloadQualityOption(
    val id: String,
    val label: String,
    val profile: String? = null,
    val height: Int? = null,
    val estimatedSizeBytes: Long? = null,
    val sizeIsEstimate: Boolean,
)

/** `GET /api/v1/media/{media_file_id}/download-options` response body -- mirrors `DownloadOptionsResponse`. */
@Serializable
data class DownloadOptionsResponse(
    val mediaFileId: String,
    val container: String,
    val options: List<DownloadQualityOption>,
)
