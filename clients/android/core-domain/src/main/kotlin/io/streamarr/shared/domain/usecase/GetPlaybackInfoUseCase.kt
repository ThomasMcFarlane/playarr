package io.streamarr.shared.domain.usecase

import io.streamarr.shared.data.model.PlaybackInfoResponse
import io.streamarr.shared.domain.model.StreamarrResult
import io.streamarr.shared.domain.model.runCatchingStreamarr
import io.streamarr.shared.domain.repository.PlaybackRepository
import javax.inject.Inject

/**
 * `GET /api/v1/playback/{media_file_id}` -- the direct-play-vs-transcode
 * negotiation the Player screen must call *before* touching `core-player`
 * at all, so it can configure `ExoPlayerStreamarrPlayer` with whichever of
 * [PlaybackInfoResponse.mode]/[PlaybackInfoResponse.url] the server
 * decided on.
 */
class GetPlaybackInfoUseCase @Inject constructor(
    private val playbackRepository: PlaybackRepository,
) {
    suspend operator fun invoke(
        mediaFileId: String,
        containers: String? = null,
        videoCodecs: String? = null,
        audioCodecs: String? = null,
        maxBitrateBps: Long? = null,
        profile: String? = null,
        forceTranscode: Boolean? = null,
        startPositionMs: Long? = null,
        audioStreamIndex: Int? = null,
        ignoreSavedPreferences: Boolean? = null,
    ): StreamarrResult<PlaybackInfoResponse> = runCatchingStreamarr {
        playbackRepository.getPlaybackInfo(
            mediaFileId = mediaFileId,
            containers = containers,
            videoCodecs = videoCodecs,
            audioCodecs = audioCodecs,
            maxBitrateBps = maxBitrateBps,
            profile = profile,
            forceTranscode = forceTranscode,
            startPositionMs = startPositionMs,
            audioStreamIndex = audioStreamIndex,
            ignoreSavedPreferences = ignoreSavedPreferences,
        )
    }
}
