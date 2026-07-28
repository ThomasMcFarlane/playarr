package io.playarr.shared.data.model

import kotlinx.serialization.Serializable

/** Cast and crew projection returned by `/api/v1/catalog/{id}/credits`. */
@Serializable
data class WorkCreditsResponse(
    val cast: List<CreditResponse> = emptyList(),
    val crew: List<CreditResponse> = emptyList(),
)

@Serializable
data class CreditResponse(
    val id: String,
    val person: PersonResponse,
    val character: String? = null,
    val department: String? = null,
    val job: String? = null,
)

@Serializable
data class PersonResponse(
    val id: String,
    val name: String,
    val headshotUrl: String? = null,
)

/** One real chapter embedded in a source media container. */
@Serializable
data class MediaChapter(
    val index: Int,
    val startMs: Long,
    val endMs: Long? = null,
    val title: String? = null,
)

@Serializable
data class MediaMetadata(val durationMs: Long)

/** Available source choices and the current user's remembered choices for one file. */
@Serializable
data class MediaPlaybackOptionsResponse(
    val qualityOptions: List<PlaybackQualityOption> = emptyList(),
    val audioTracks: List<PlaybackAudioTrackOption> = emptyList(),
    val subtitleTracks: List<PlaybackSubtitleTrackOption> = emptyList(),
    val preferences: MediaPlaybackPreferenceResponse,
)

@Serializable
data class MediaPlaybackPreferenceResponse(
    val qualityId: String,
    val audioTrackId: String? = null,
    val subtitleTrackId: String? = null,
)

@Serializable
data class UpdateMediaPlaybackPreferencesRequest(
    val qualityId: String,
    val audioTrackId: String? = null,
    val subtitleTrackId: String? = null,
)
