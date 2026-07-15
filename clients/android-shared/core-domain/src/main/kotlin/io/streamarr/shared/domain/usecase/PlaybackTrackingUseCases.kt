package io.streamarr.shared.domain.usecase

import io.streamarr.shared.data.model.ClientPlatform
import io.streamarr.shared.data.model.PlaybackEventKind
import io.streamarr.shared.data.model.PlaybackSession
import io.streamarr.shared.data.model.StopReason
import io.streamarr.shared.domain.model.StreamarrResult
import io.streamarr.shared.domain.model.runCatchingStreamarr
import io.streamarr.shared.domain.repository.PlaybackRepository
import javax.inject.Inject

/** Opens a [PlaybackSession] server-side the moment `core-player` starts playing a [io.streamarr.shared.data.model.MediaFile]. */
class StartPlaybackSessionUseCase @Inject constructor(
    private val playbackRepository: PlaybackRepository,
) {
    suspend operator fun invoke(
        mediaFileId: String,
        clientPlatform: ClientPlatform,
        clientVersion: String,
    ): StreamarrResult<PlaybackSession> = runCatchingStreamarr {
        playbackRepository.startSession(mediaFileId, clientPlatform, clientVersion)
    }
}

/**
 * Reports a periodic playback position heartbeat, driven by
 * `core-player`'s position-polling loop, so resume state and concurrent
 * session accounting stay current server-side during long-running plays
 * (not just at start/stop).
 */
class RecordPlaybackHeartbeatUseCase @Inject constructor(
    private val playbackRepository: PlaybackRepository,
) {
    suspend operator fun invoke(sessionId: String, positionMs: Long): StreamarrResult<Unit> = runCatchingStreamarr {
        playbackRepository.recordEvent(sessionId, PlaybackEventKind.Heartbeat(positionMs))
    }
}

/** Reports session end -- user-initiated stop, natural completion, or an unrecoverable playback error. */
class RecordPlaybackStopUseCase @Inject constructor(
    private val playbackRepository: PlaybackRepository,
) {
    suspend operator fun invoke(
        sessionId: String,
        positionMs: Long,
        reason: StopReason,
    ): StreamarrResult<Unit> = runCatchingStreamarr {
        playbackRepository.recordEvent(sessionId, PlaybackEventKind.Stop(reason, positionMs))
    }
}
