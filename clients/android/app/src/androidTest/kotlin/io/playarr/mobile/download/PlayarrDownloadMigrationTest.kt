package io.playarr.mobile.download

import android.database.sqlite.SQLiteDatabase
import androidx.room.Room
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import io.playarr.shared.download.db.PLAYARR_DOWNLOAD_MIGRATION_1_2
import io.playarr.shared.download.db.PLAYARR_DOWNLOAD_MIGRATION_2_3
import io.playarr.shared.download.db.PlayarrDownloadDatabase
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class PlayarrDownloadMigrationTest {
    private val context = InstrumentationRegistry.getInstrumentation().targetContext
    private val databaseName = "download-migration-test.db"

    @Before
    fun createVersionOneDatabase() {
        context.deleteDatabase(databaseName)
        SQLiteDatabase.openOrCreateDatabase(context.getDatabasePath(databaseName), null).use { database ->
            database.execSQL(
                """
                CREATE TABLE download_metadata (
                    mediaFileId TEXT NOT NULL PRIMARY KEY,
                    workId TEXT NOT NULL,
                    title TEXT NOT NULL,
                    workTitle TEXT NOT NULL,
                    posterUrl TEXT,
                    kind TEXT NOT NULL,
                    qualityId TEXT NOT NULL,
                    ticketId TEXT,
                    keepUntilEpochMillis INTEGER,
                    addedAtEpochMillis INTEGER NOT NULL
                )
                """.trimIndent(),
            )
            database.execSQL(
                """
                CREATE TABLE pending_progress (
                    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
                    mediaFileId TEXT NOT NULL,
                    positionMs INTEGER NOT NULL,
                    durationMs INTEGER NOT NULL,
                    completed INTEGER NOT NULL,
                    occurredAtEpochMillis INTEGER NOT NULL
                )
                """.trimIndent(),
            )
            database.execSQL(
                """
                INSERT INTO download_metadata (
                    mediaFileId, workId, title, workTitle, posterUrl, kind, qualityId,
                    ticketId, keepUntilEpochMillis, addedAtEpochMillis
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """.trimIndent(),
                arrayOf<Any?>(
                    "media-1",
                    "work-1",
                    "Title",
                    "Work",
                    null,
                    "movie",
                    "original",
                    "ticket-1",
                    null,
                    7L,
                ),
            )
            database.version = 1
        }
    }

    @After
    fun removeTestDatabase() {
        context.deleteDatabase(databaseName)
    }

    @Test
    fun migrationsPreserveRowsAndAddServerAndRetentionColumns() = runBlocking {
        val database = Room.databaseBuilder(context, PlayarrDownloadDatabase::class.java, databaseName)
            .addMigrations(PLAYARR_DOWNLOAD_MIGRATION_1_2, PLAYARR_DOWNLOAD_MIGRATION_2_3)
            .build()
        try {
            val row = database.downloadMetadataDao().get("media-1")

            assertEquals(3, database.openHelper.readableDatabase.version)
            assertEquals("media-1", row?.mediaFileId)
            assertEquals("ticket-1", row?.ticketId)
            assertEquals("", row?.serverUrl)
            assertEquals(null, row?.keepUntilAmount)
            assertEquals(null, row?.keepUntilUnit)
            assertEquals(null, row?.watchedAtEpochMillis)
        } finally {
            database.close()
        }
    }
}
