package io.streamarr.shared.download.db

import androidx.room.Database
import androidx.room.RoomDatabase
import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase

/**
 * Local Room database backing [DownloadMetadataDao]/[PendingProgressDao].
 * Deliberately not Media3's `DownloadIndex` -- that stays entirely inside
 * Media3's own offline-download stack (see `DownloadRepository`'s KDoc);
 * this is only the two things it doesn't track.
 *
 * `exportSchema = false`: no `schemas/` directory is checked in yet. Schema 3 preserves existing
 * primary-server rows through [STREAMARR_DOWNLOAD_MIGRATION_1_2]; future migrations should enable
 * checked-in schema export so Room can validate their complete history.
 */
@Database(
    entities = [DownloadMetadataEntity::class, PendingProgressEntity::class],
    version = 3,
    exportSchema = false,
)
abstract class StreamarrDownloadDatabase : RoomDatabase() {
    abstract fun downloadMetadataDao(): DownloadMetadataDao
    abstract fun pendingProgressDao(): PendingProgressDao
}

val STREAMARR_DOWNLOAD_MIGRATION_1_2 = object : Migration(1, 2) {
    override fun migrate(db: SupportSQLiteDatabase) {
        db.execSQL("ALTER TABLE download_metadata ADD COLUMN serverUrl TEXT NOT NULL DEFAULT ''")
    }
}

val STREAMARR_DOWNLOAD_MIGRATION_2_3 = object : Migration(2, 3) {
    override fun migrate(db: SupportSQLiteDatabase) {
        db.execSQL("ALTER TABLE download_metadata ADD COLUMN keepUntilAmount INTEGER")
        db.execSQL("ALTER TABLE download_metadata ADD COLUMN keepUntilUnit TEXT")
        db.execSQL("ALTER TABLE download_metadata ADD COLUMN watchedAtEpochMillis INTEGER")
    }
}
