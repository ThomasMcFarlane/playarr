package io.playarr.mobile.ui

import io.playarr.shared.data.model.FolderBreadcrumb
import io.playarr.shared.data.model.FolderBrowseResponse
import io.playarr.shared.data.model.FolderEntry
import io.playarr.shared.data.model.FolderEntryType
import io.playarr.shared.data.model.WorkKind
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PlayarrFoldersTest {
    @Test
    fun `server breadcrumb chain already owns the root entry`() {
        val response = FolderBrowseResponse(
            root = io.playarr.shared.data.model.FolderRoot(
                id = "root-1",
                sourceInstanceId = "source-1",
                sourceName = "Movies",
                libraryKind = WorkKind.Movie,
                name = "Films",
                available = true,
            ),
            path = "Classics",
            breadcrumbs = listOf(
                FolderBreadcrumb("Films", ""),
                FolderBreadcrumb("Classics", "Classics"),
            ),
            entries = emptyList(),
            total = 0,
            offset = 0,
            limit = 200,
        )

        assertEquals(listOf("", "Classics"), response.breadcrumbs.map(FolderBreadcrumb::path))
    }

    @Test
    fun `folder queue keeps playable media order and marks file-derived audio`() {
        val entries = listOf(
            FolderEntry(FolderEntryType.Directory, "Disc 1", "Disc 1"),
            FolderEntry(
                entryType = FolderEntryType.Media,
                name = "01 - Intro.flac",
                path = "01 - Intro.flac",
                mediaFileId = "track-1",
                mediaKind = WorkKind.Artist,
                title = "Intro",
                artist = "Artist",
                album = "Album",
                audioCodec = "flac",
            ),
            FolderEntry(
                entryType = FolderEntryType.Media,
                name = "Trailer.mkv",
                path = "Trailer.mkv",
                mediaFileId = "video-1",
                mediaKind = WorkKind.Movie,
                videoCodec = "h264",
            ),
            FolderEntry(FolderEntryType.Media, "Pending.mkv", "Pending.mkv"),
        )

        val queue = folderPlaybackQueueItems(entries)

        assertEquals(listOf("track-1", "video-1"), queue.map(PlayarrPlaybackQueueItem::mediaFileId))
        assertEquals("Intro", queue.first().title)
        assertEquals("Artist · Album", queue.first().subtitle)
        assertTrue(queue.first().music)
        assertFalse(queue.last().music)
    }

    @Test
    fun `folder helpers preserve root-relative navigation and format technical metadata`() {
        val entry = FolderEntry(
            entryType = FolderEntryType.Media,
            name = "Episode.mkv",
            path = "Show/Season 1/Episode.mkv",
            mediaFileId = "episode-1",
            container = "mkv",
            videoCodec = "hevc",
            audioCodec = "eac3",
            durationMs = 3_723_000,
            sizeBytes = 1_572_864,
            width = 3840,
            height = 2160,
            modifiedAt = "2026-07-31T08:00:00Z",
        )

        assertEquals("Show/Season 1", folderParentPath("Show/Season 1/Episode.mkv"))
        assertEquals("", folderParentPath("Show"))
        assertEquals("1:02:03", formatFolderDuration(entry.durationMs))
        assertEquals("1.5 MB", formatFolderSize(entry.sizeBytes))
        assertEquals(
            "MKV · 3840×2160 · HEVC · EAC3 · 1:02:03 · 1.5 MB · 2026-07-31",
            folderEntryMetadata(entry),
        )
    }

    @Test
    fun `failed nested browse keeps the requested path for retry`() {
        val loading = PlayarrFolderBrowserState().beginFolderBrowse(
            rootId = "root-1",
            path = "Shows/Season 1",
        )
        val failed = loading.copy(
            browse = ExperienceLoad.Failed(PlayarrMessage.Dynamic("Temporarily unavailable")),
        )

        assertEquals("root-1", failed.selectedRootId)
        assertEquals("Shows/Season 1", failed.requestedPath)
    }
}
