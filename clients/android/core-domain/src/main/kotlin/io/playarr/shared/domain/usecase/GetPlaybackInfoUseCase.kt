package io.playarr.shared.domain.usecase

import io.playarr.shared.data.model.PlaybackInfoResponse
import io.playarr.shared.domain.model.PlayarrResult
import io.playarr.shared.domain.model.runCatchingPlayarr
import io.playarr.shared.domain.repository.PlaybackRepository
import javax.inject.Inject

/**
 * `GET /api/v1/playback/{media_file_id}` -- the direct-play-vs-transcode
 * negotiation the Player screen must call *before* touching `core-player`
 * at all, so it can configure `ExoPlayerPlayarrPlayer` with whichever of
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
    ): PlayarrResult<PlaybackInfoResponse> = runCatchingPlayarr {
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
