package io.playarr.mobile.ui

import io.playarr.shared.data.model.Availability
import io.playarr.shared.data.model.Episode
import io.playarr.shared.data.model.EpisodeDetail
import io.playarr.shared.data.model.Season
import io.playarr.shared.data.model.SeasonDetail
import io.playarr.shared.data.model.Work
import io.playarr.shared.data.model.WorkChildren
import io.playarr.shared.data.model.WorkDetail
import io.playarr.shared.data.model.WorkKind
import io.playarr.shared.download.DownloadEntity
import io.playarr.shared.download.DownloadState
import java.time.Instant
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

    @Test
    fun `device storage matches downloaded bytes and remaining capacity`() {
        val first = download(kind = "movie", title = "First", workTitle = "First")
            .copy(bytesDownloaded = 100, totalBytes = 200)
        val second = download(kind = "movie", title = "Second", workTitle = "Second")
            .copy(mediaFileId = "second", bytesDownloaded = 300, totalBytes = 300)

        assertEquals(
            DownloadStorageUsage(usedBytes = 400, quotaBytes = 1_000, percent = 40),
            calculateDownloadStorageUsage(listOf(first, second), availableBytes = 600),
        )
    }

    @Test
    fun `legacy download quality id remains a visible label fallback`() {
        assertEquals("original", download(kind = "movie", title = "Movie", workTitle = "Movie").qualityLabel)
    }

    @Test
    fun `focused series download resolves its matching episode for the TV preview`() {
        val episode = EpisodeDetail(
            episode = Episode(
                id = "episode",
                seasonId = "season",
                episodeNumber = 3,
                title = "The Episode",
                overview = "Episode overview",
                monitored = true,
                availability = Availability.Available,
            ),
            mediaFileId = "media",
        )
        val detail = WorkDetail(
            work = Work(
                id = "work",
                kind = WorkKind.Series,
                title = "The Series",
                sortTitle = "Series, The",
                overview = "Series overview",
                genres = listOf("Drama"),
                releaseDate = Instant.parse("2025-01-01T00:00:00Z"),
                addedAt = Instant.parse("2026-01-01T00:00:00Z"),
                monitored = true,
                availability = Availability.Available,
            ),
            children = WorkChildren.Series(
                listOf(
                    SeasonDetail(
                        season = Season(
                            id = "season",
                            seriesWorkId = "work",
                            seasonNumber = 2,
                            monitored = true,
                            availability = Availability.Available,
                        ),
                        episodes = listOf(episode),
                    ),
                ),
            ),
        )

        val preview = resolveDownloadFocusedPreview(detail, "media")

        assertEquals(2, preview.seasonNumber)
        assertEquals(episode, preview.episode)
        assertNull(resolveDownloadFocusedPreview(detail, "different").episode)
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
