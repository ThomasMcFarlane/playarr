package io.streamarr.shared.download.db

import androidx.room.Database
import androidx.room.RoomDatabase

/**
 * Local Room database backing [DownloadMetadataDao]/[PendingProgressDao].
 * Deliberately not Media3's `DownloadIndex` -- that stays entirely inside
 * Media3's own offline-download stack (see `DownloadRepository`'s KDoc);
 * this is only the two things it doesn't track.
 *
 * `exportSchema = false`: no `schemas/` directory is checked in to diff
 * migrations against. There is exactly one shipped schema version so far
 * and no migration path to test yet -- if a future column/table change
 * needs a real migration, turn this back on and commit the exported
 * schema JSON alongside it rather than silently destructively-recreating
 * (Room's default `fallbackToDestructiveMigration` behavior) a real user's
 * downloaded-items list.
 */
@Database(
    entities = [DownloadMetadataEntity::class, PendingProgressEntity::class],
    version = 1,
    exportSchema = false,
)
abstract class StreamarrDownloadDatabase : RoomDatabase() {
    abstract fun downloadMetadataDao(): DownloadMetadataDao
    abstract fun pendingProgressDao(): PendingProgressDao
}
