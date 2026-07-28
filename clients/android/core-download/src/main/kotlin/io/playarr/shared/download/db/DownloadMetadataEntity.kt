package io.playarr.shared.download.db

import androidx.room.Dao
import androidx.room.Entity
import androidx.room.PrimaryKey
import androidx.room.Query
import androidx.room.Upsert
import kotlinx.coroutines.flow.Flow

/**
 * The only per-download state Media3's own `DownloadIndex` doesn't already
 * track: display metadata and the Keep-until policy. Media3's
 * `DownloadIndex`/`DownloadManager` remain the source of truth for byte
 * progress/state -- see `DownloadRepository`'s KDoc.
 */
@Entity(tableName = "download_metadata")
data class DownloadMetadataEntity(
    @PrimaryKey val mediaFileId: String,
    val workId: String,
    val title: String,
    val workTitle: String,
    val posterUrl: String?,
    /** `"movie" | "episode" | "track" | "book"`. */
    val kind: String,
    val qualityId: String,
    val qualityLabel: String = qualityId,
    /** The server `DownloadTicket` id this download's bytes are fetched from. */
    val ticketId: String?,
    /** Owning server origin; blank only for rows migrated from the original primary-only schema. */
    val serverUrl: String,
    /** `null` means "keep forever". */
    val keepUntilEpochMillis: Long?,
    /** Non-null only for an unresolved `AfterWatched` policy. */
    val keepUntilAmount: Int? = null,
    /** `"days" | "weeks"`; non-null only with [keepUntilAmount]. */
    val keepUntilUnit: String? = null,
    /** Actual local/server watched timestamp used to resolve an `AfterWatched` policy. */
    val watchedAtEpochMillis: Long? = null,
    val addedAtEpochMillis: Long,
)

@Dao
interface DownloadMetadataDao {
    @Query("SELECT * FROM download_metadata")
    fun observeAll(): Flow<List<DownloadMetadataEntity>>

    @Query("SELECT * FROM download_metadata WHERE mediaFileId = :mediaFileId")
    suspend fun get(mediaFileId: String): DownloadMetadataEntity?

    @Query("SELECT * FROM download_metadata")
    suspend fun getAllOnce(): List<DownloadMetadataEntity>

    @Upsert
    suspend fun upsert(entity: DownloadMetadataEntity)

    @Query("DELETE FROM download_metadata WHERE mediaFileId = :mediaFileId")
    suspend fun delete(mediaFileId: String)

    @Query(
        """
        UPDATE download_metadata
        SET keepUntilEpochMillis = :keepUntilEpochMillis,
            keepUntilAmount = :keepUntilAmount,
            keepUntilUnit = :keepUntilUnit,
            watchedAtEpochMillis = :watchedAtEpochMillis
        WHERE mediaFileId = :mediaFileId
        """,
    )
    suspend fun updateKeepUntil(
        mediaFileId: String,
        keepUntilEpochMillis: Long?,
        keepUntilAmount: Int?,
        keepUntilUnit: String?,
        watchedAtEpochMillis: Long?,
    )

    @Query("UPDATE download_metadata SET watchedAtEpochMillis = :watchedAtEpochMillis WHERE mediaFileId = :mediaFileId")
    suspend fun updateWatchedAt(mediaFileId: String, watchedAtEpochMillis: Long)
}
