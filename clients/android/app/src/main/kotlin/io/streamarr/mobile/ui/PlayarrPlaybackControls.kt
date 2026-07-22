package io.streamarr.mobile.ui

import io.streamarr.shared.data.model.PlaybackAudioTrackOption
import io.streamarr.shared.data.model.PlaybackQualityOption
import io.streamarr.shared.data.model.PlaybackSubtitleTrackOption

internal data class PlayarrPlaybackControls(
    val qualityOptions: List<PlaybackQualityOption> = emptyList(),
    val activeQualityId: String = "original",
    val audioTracks: List<PlaybackAudioTrackOption> = emptyList(),
    val selectedAudioTrackId: String? = null,
    val subtitleTracks: List<PlaybackSubtitleTrackOption> = emptyList(),
    val selectedSubtitleTrackId: String? = null,
    val switching: Boolean = false,
    val error: String? = null,
)

internal const val playarrAndroidContainers = "mp4,webm,mkv,mp3,flac,m4a,ogg,opus,wav"
internal const val playarrAndroidVideoCodecs = "h264,h265,vp9,av1"
internal const val playarrAndroidAudioCodecs = "aac,opus,mp3,flac,vorbis,pcm_s16le,pcm_s24le"
