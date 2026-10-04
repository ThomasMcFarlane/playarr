package io.playarr.mobile.ui

import io.playarr.shared.data.model.UserDataExportJob
import io.playarr.shared.data.model.UserDataExportStatus
import io.playarr.shared.data.model.UserDataImportPreview
import io.playarr.shared.data.model.UserDataImportResult
import io.playarr.shared.data.model.UserDataImportSession
import io.playarr.shared.data.model.UserDataTransferLink
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
    fun `preview decodes the watchlist section and tolerates its absence`() {
        val with = json.decodeFromString<UserDataImportPreview>(
            """{"package_sha256":"f00","summary":{"watchlist":{"total":6,"will_add":3,"already_present":2,"unmatched":1}}}""",
        )
        assertEquals(3, with.summary.watchlist?.willAdd)
        assertEquals(2, with.summary.watchlist?.alreadyPresent)
        assertEquals(1, with.summary.watchlist?.unmatched)
        val without = json.decodeFromString<UserDataImportPreview>("""{"package_sha256":"f00"}""")
        assertNull(without.summary.watchlist)
        val text = PlayarrLanguageState("en", PlayarrResolvedLanguage.English).text(
            PlayarrString.YourDataPreviewWatchlist,
            mapOf("add" to 3, "same" to 2, "unmatched" to 1),
        )
        assertEquals("Watchlist: 3 new, 2 already here, 1 could not be placed.", text)
    }

    @Test
    fun `transfer link and import session decode and gate the television preview`() {
        val link = json.decodeFromString<UserDataTransferLink>(
            """{"path":"/api/v1/transfer/export/abc","url":"https://server.example/api/v1/transfer/export/abc","expires_at":"2026-10-03T12:15:00Z","future":1}""",
        )
        assertEquals("https://server.example/api/v1/transfer/export/abc", link.url)
        val waiting = json.decodeFromString<UserDataImportSession>(
            """{"id":"s1","status":"waiting","upload_path":"/api/v1/transfer/import/t","upload_url":"https://server.example/api/v1/transfer/import/t","expires_at":"2026-10-03T12:15:00Z","size_bytes":null}""",
        )
        assertEquals("https://server.example/api/v1/transfer/import/t", waiting.uploadUrl)
        assertFalse(waiting.isUploaded)
        val uploaded = waiting.copy(status = "uploaded", sizeBytes = 2048)
        assertTrue(uploaded.isUploaded)

        assertFalse(YourDataState().canPreviewSession)
        assertFalse(YourDataState(session = waiting).canPreviewSession)
        assertTrue(YourDataState(session = uploaded).canPreviewSession)
        assertFalse(YourDataState(session = uploaded, importBusy = true).canPreviewSession)
        // The television path never needs a chosen file.
        assertFalse(YourDataState(session = uploaded).canPreview)
    }

    @Test
    fun `expiry clock and sizes are readable and tolerate bad input`() {
        val zone = java.time.ZoneId.of("UTC")
        assertTrue(expiryClock("2026-10-03T12:15:00Z", zone).contains("15"))
        assertEquals("", expiryClock(null, zone))
        assertEquals("", expiryClock("not a time", zone))
        assertEquals("", formatTransferSize(null))
        assertEquals("512 B", formatTransferSize(512))
        assertEquals("2.0 KB", formatTransferSize(2048))
        assertEquals("1.5 MB", formatTransferSize(1_572_864))
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
