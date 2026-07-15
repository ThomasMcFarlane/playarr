package io.streamarr.shared.domain.repository

import io.streamarr.shared.data.model.ClientPlatform
import io.streamarr.shared.data.model.PlaybackEvent
import io.streamarr.shared.data.model.PlaybackEventKind
import io.streamarr.shared.data.model.PlaybackSession
import io.streamarr.shared.data.remote.StartPlaybackSessionRequest
import io.streamarr.shared.data.remote.StreamarrApi
import io.streamarr.shared.data.remote.wireName
import java.time.Instant
import java.util.UUID
import javax.inject.Inject

/** Playback session lifecycle and analytics-event reporting, independent of transport. */
interface PlaybackRepository {
    suspend fun startSession(mediaFileId: String, clientPlatform: ClientPlatform, clientVersion: String): PlaybackSession
    suspend fun recordEvent(sessionId: String, kind: PlaybackEventKind)
}

class DefaultPlaybackRepository @Inject constructor(
    private val api: StreamarrApi,
) : PlaybackRepository {

    override suspend fun startSession(
        mediaFileId: String,
        clientPlatform: ClientPlatform,
        clientVersion: String,
    ): PlaybackSession = api.startPlaybackSession(
        StartPlaybackSessionRequest(
            mediaFileId = mediaFileId,
            clientPlatform = clientPlatform.wireName(),
            clientVersion = clientVersion,
        ),
    )

    override suspend fun recordEvent(sessionId: String, kind: PlaybackEventKind) {
        api.recordPlaybackEvent(
            sessionId = sessionId,
            event = PlaybackEvent(
                id = UUID.randomUUID().toString(),
                sessionId = sessionId,
                occurredAt = Instant.now(),
                kind = kind,
            ),
        )
    }
}
