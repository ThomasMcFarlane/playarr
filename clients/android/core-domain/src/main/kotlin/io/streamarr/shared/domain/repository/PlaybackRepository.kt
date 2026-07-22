package io.streamarr.shared.domain.repository

import io.streamarr.shared.data.model.PlaybackInfoResponse
import io.streamarr.shared.data.remote.StreamarrApi
import javax.inject.Inject

/**
 * Playback negotiation, independent of transport: resolves whether a
 * `mediaFileId` should be direct-played or served an HLS transcode, and
 * where from. `GET /api/v1/playback/{media_file_id}` is a stateless
 * decision endpoint in the real spec -- there is no session-lifecycle or
 * analytics-event API to wrap here (the Wave-1 placeholder this replaced
 * spoke to `/api/playback/sessions`, which was never real).
 */
interface PlaybackRepository {
    suspend fun getPlaybackInfo(
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
    ): PlaybackInfoResponse
}

class DefaultPlaybackRepository @Inject constructor(
    private val api: StreamarrApi,
) : PlaybackRepository {

    override suspend fun getPlaybackInfo(
        mediaFileId: String,
        containers: String?,
        videoCodecs: String?,
        audioCodecs: String?,
        maxBitrateBps: Long?,
        profile: String?,
        forceTranscode: Boolean?,
        startPositionMs: Long?,
        audioStreamIndex: Int?,
        ignoreSavedPreferences: Boolean?,
    ): PlaybackInfoResponse = api.getPlaybackInfo(
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
