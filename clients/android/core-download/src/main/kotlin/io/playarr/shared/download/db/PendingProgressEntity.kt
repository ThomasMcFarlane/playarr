package io.playarr.shared.download.db

import androidx.room.Dao
import androidx.room.Entity
import androidx.room.Insert
import androidx.room.PrimaryKey
import androidx.room.Query

/**
 * A watch-progress update that couldn't reach the server immediately (this
 * device was offline, e.g. mid-playback of a downloaded file) -- buffered
 * here so [io.playarr.shared.download.OfflineProgressRepository.flushPending]
 * can replay it once connectivity returns, stamped with [occurredAtEpochMillis]
 * (via `UpdateWatchProgressRequest.occurredAt`) so the server records when
 * the watch actually happened rather than when the replay call landed.
 */
@Entity(tableName = "pending_progress")
data class PendingProgressEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val mediaFileId: String,
    val positionMs: Long,
    val durationMs: Long,
    val completed: Boolean,
    val occurredAtEpochMillis: Long,
)

@Dao
interface PendingProgressDao {
    @Query("SELECT * FROM pending_progress ORDER BY id ASC")
    suspend fun getAll(): List<PendingProgressEntity>

    @Insert
    suspend fun insert(entity: PendingProgressEntity): Long

    @Query("DELETE FROM pending_progress WHERE id = :id")
    suspend fun delete(id: Long)
}
