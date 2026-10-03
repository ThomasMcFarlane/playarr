package io.playarr.shared.download

import io.playarr.shared.auth.TokenStore
import io.playarr.shared.data.model.UpdateWatchProgressRequest
import io.playarr.shared.data.remote.PlayarrApi
import io.playarr.shared.download.db.PendingProgressDao
import io.playarr.shared.download.db.PendingProgressEntity
import java.time.Instant
import javax.inject.Inject

internal const val MAX_PENDING_PROGRESS_REPLAY_BATCH = 25

/**
 * Buffers `PUT /api/v1/playback/{media_file_id}/progress` updates that
 * can't reach the server immediately -- the expected case while watching a
 * downloaded file with no network at all -- and replays them once
 * connectivity returns, stamped with [UpdateWatchProgressRequest.occurredAt]
 * so the server records when the watch actually happened rather than when
 * the replay call landed.
 *
 * Not part of [DownloadRepository] itself: this is orthogonal to *which*
 * bytes are on disk, and every playback screen (downloaded or streamed)
 * calls it the same way -- see `ExperiencePlayerViewModel.persistProgress`.
 */
interface OfflineProgressRepository {
    /** Tries the live call first; only buffers locally if that call fails. */
    suspend fun record(mediaFileId: String, positionMs: Long, durationMs: Long, completed: Boolean)

    /** Replays every buffered update, oldest first. Safe to call opportunistically -- a still-offline row is simply left queued. */
    suspend fun flushPending()
}

class DefaultOfflineProgressRepository internal constructor(
    private val api: PlayarrApi,
    private val dao: PendingProgressDao,
    private val ownerKey: suspend () -> String,
) : OfflineProgressRepository {
    @Inject
    constructor(api: PlayarrApi, dao: PendingProgressDao, tokenStore: TokenStore) :
        this(api, dao, { tokenStore.currentOwnerKey() })

    override suspend fun record(mediaFileId: String, positionMs: Long, durationMs: Long, completed: Boolean) {
        val owner = ownerKey()
        val succeeded = runCatching {
            api.updateWatchProgress(mediaFileId, UpdateWatchProgressRequest(positionMs, durationMs, completed))
        }.isSuccess
        if (!succeeded) {
            dao.insert(
                PendingProgressEntity(
                    mediaFileId = mediaFileId,
                    positionMs = positionMs,
                    durationMs = durationMs,
                    completed = completed,
                    occurredAtEpochMillis = System.currentTimeMillis(),
                    ownerKey = owner,
                ),
            )
        }
    }

    override suspend fun flushPending() {
        // Only the active account's rows: another account's offline watches must never be posted under this session.
        val owner = ownerKey()
        if (owner.isBlank()) return
        for (pending in dao.getBatch(MAX_PENDING_PROGRESS_REPLAY_BATCH, owner)) {
            val occurredAt = Instant.ofEpochMilli(pending.occurredAtEpochMillis).toString()
            val succeeded = runCatching {
                api.updateWatchProgress(
                    pending.mediaFileId,
                    UpdateWatchProgressRequest(pending.positionMs, pending.durationMs, pending.completed, occurredAt),
                )
            }.isSuccess
            if (!succeeded) break
            dao.delete(pending.id)
        }
    }
}
