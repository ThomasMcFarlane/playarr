package io.streamarr.mobile.ui

import io.streamarr.shared.download.DownloadEntity
import io.streamarr.shared.download.DownloadState
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class PlayarrDownloadsTest {
    @Test
    fun `download states map into the same three groups as the web page`() {
        assertEquals(PlayarrDownloadGroup.Active, DownloadState.Queued.playarrDownloadGroup())
        assertEquals(PlayarrDownloadGroup.Active, DownloadState.Downloading.playarrDownloadGroup())
        assertEquals(PlayarrDownloadGroup.Active, DownloadState.Paused.playarrDownloadGroup())
        assertEquals(PlayarrDownloadGroup.NeedsAttention, DownloadState.Failed.playarrDownloadGroup())
        assertEquals(PlayarrDownloadGroup.Completed, DownloadState.Completed.playarrDownloadGroup())
    }

    @Test
    fun `completed download becomes an offline playback queue item`() {
        val track = download(kind = "track", title = "Track", workTitle = "Artist")
        val movie = download(kind = "movie", title = "Movie", workTitle = "Movie")

        with(track.playarrPlaybackQueueItem()) {
            assertEquals("media", mediaFileId)
            assertEquals("Track", title)
            assertEquals("Artist", subtitle)
            assertTrue(music)
        }
        with(movie.playarrPlaybackQueueItem()) {
            assertNull(subtitle)
            assertFalse(music)
        }
    }

    private fun download(kind: String, title: String, workTitle: String) = DownloadEntity(
        mediaFileId = "media",
        workId = "work",
        title = title,
        workTitle = workTitle,
        posterUrl = null,
        kind = kind,
        qualityId = "original",
        ticketId = null,
        serverUrl = "https://playarr.example",
        state = DownloadState.Completed,
        bytesDownloaded = 100,
        totalBytes = 100,
        keepUntilEpochMillis = null,
        failureMessage = null,
        addedAtEpochMillis = 0,
    )
}
