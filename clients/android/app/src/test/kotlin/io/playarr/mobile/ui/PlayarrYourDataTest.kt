package io.playarr.mobile.ui

import io.playarr.shared.data.model.UserDataExportJob
import io.playarr.shared.data.model.UserDataExportStatus
import io.playarr.shared.data.model.UserDataImportPreview
import io.playarr.shared.data.model.UserDataImportResult
import io.playarr.shared.data.model.UserDataProgressConflicts
import java.io.ByteArrayInputStream
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class PlayarrYourDataTest {
    private val json = Json { ignoreUnknownKeys = true }

    @Test
    fun `export job decodes the server shape and tolerates unknown fields`() {
        val job = json.decodeFromString<UserDataExportJob>(
            """{"id":"abc","status":"ready","created_at":"2026-10-03T12:00:00Z","expires_at":"2026-10-03T12:30:00Z",
            "progress":{"stage":"done","done":1,"total":1},
            "counts":{"watch_progress":4,"playback_preferences":0,"playlists":2,"playlist_items":5,"skipped":1},
            "size_bytes":2048,"download_url":"/api/v1/users/me/data-exports/abc/download","error":null,"future":true}""",
        )
        assertEquals(UserDataExportStatus.Ready, job.status)
        assertEquals(4, job.counts.watchProgress)
        assertEquals(2048L, job.sizeBytes)
        assertEquals("2026-10-03", job.createdAt.take(10))
    }

    @Test
    fun `preview and result decode and the running state gates the buttons`() {
        val preview = json.decodeFromString<UserDataImportPreview>(
            """{"package_sha256":"f00","summary":{"watch_progress":{"total":5,"will_add":3,"will_update":1,
            "already_present":0,"conflicts_kept":0,"unmatched":1,"ambiguous":0},
            "playlists":{"total":1,"new":1,"existing":0,"items_total":2,"items_to_add":2,"items_already_present":0,"items_unmatched":0},
            "preferred_audio_language_change":"ja","playback_preferences_not_applied":2,"unmatched_total":1},
            "samples":[],"warnings":["info"]}""",
        )
        assertEquals("f00", preview.packageSha256)
        assertEquals(3, preview.summary.watchProgress.willAdd)
        assertEquals("ja", preview.summary.preferredAudioLanguageChange)

        val result = json.decodeFromString<UserDataImportResult>(
            """{"completed":false,"failure":"boom","sections_not_attempted":["preferences"],"unmatched_total":2}""",
        )
        assertFalse(result.completed)
        assertEquals(listOf("preferences"), result.sectionsNotAttempted)

        val idle = YourDataState(fileName = "a.zip")
        assertTrue(idle.canPreview)
        assertFalse(idle.canApply)
        val previewed = idle.copy(preview = preview)
        assertTrue(previewed.canApply)
        assertFalse(previewed.copy(result = result).canApply)
        assertFalse(previewed.copy(importBusy = true).canApply)
        assertFalse(YourDataState().canPreview)
    }

    @Test
    fun `an export that is queued or running counts as running`() {
        fun job(status: UserDataExportStatus) = UserDataExportJob("x", status, "2026-10-03T12:00:00Z")
        assertTrue(YourDataState(exportJob = job(UserDataExportStatus.Queued)).exportRunning)
        assertTrue(YourDataState(exportJob = job(UserDataExportStatus.Running)).exportRunning)
        assertFalse(YourDataState(exportJob = job(UserDataExportStatus.Ready)).exportRunning)
        assertFalse(YourDataState().exportRunning)
    }

    @Test
    fun `conflict policies use the server's wire names`() {
        assertEquals("newest", UserDataProgressConflicts.Newest.wire)
        assertEquals("keep_existing", UserDataProgressConflicts.KeepExisting.wire)
    }

    @Test
    fun `bounded reads stop at the import limit instead of buffering a huge file`() {
        assertNotNull(readBoundedBytes(ByteArrayInputStream(ByteArray(10)), limit = 10))
        assertNull(readBoundedBytes(ByteArrayInputStream(ByteArray(11)), limit = 10))
        assertEquals(0, readBoundedBytes(ByteArrayInputStream(ByteArray(0)), limit = 10)?.size)
    }

    @Test
    fun `the export file name is dated and has no path characters`() {
        assertEquals("playarr-user-data-2026-10-03.zip", userDataExportFileName("2026-10-03"))
    }

    @Test
    fun `every your-data string has English Thai and Japanese text`() {
        PlayarrString.entries.filter { it.name.startsWith("YourData") || it.name.startsWith("SettingsYourData") }
            .forEach { key ->
                assertTrue(key.name, key.english.isNotBlank() && key.thai.isNotBlank() && key.japanese.isNotBlank())
            }
    }
}
