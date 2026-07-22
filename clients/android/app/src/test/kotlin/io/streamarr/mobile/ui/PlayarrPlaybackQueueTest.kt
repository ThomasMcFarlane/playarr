package io.streamarr.mobile.ui

import io.streamarr.shared.data.model.Album
import io.streamarr.shared.data.model.AlbumDetail
import io.streamarr.shared.data.model.AlbumType
import io.streamarr.shared.data.model.Availability
import io.streamarr.shared.data.model.Episode
import io.streamarr.shared.data.model.EpisodeDetail
import io.streamarr.shared.data.model.Season
import io.streamarr.shared.data.model.SeasonDetail
import io.streamarr.shared.data.model.Track
import io.streamarr.shared.data.model.TrackDetail
import io.streamarr.shared.data.model.Work
import io.streamarr.shared.data.model.WorkChildren
import io.streamarr.shared.data.model.WorkDetail
import io.streamarr.shared.data.model.WorkKind
import java.time.Instant
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PlayarrPlaybackQueueTest {
    @Test
    fun `queue retains ordered context and moves within its boundaries`() {
        val items = listOf(
            PlayarrPlaybackQueueItem("first", "Episode one", "Series · S01 E01", 1, 1),
            PlayarrPlaybackQueueItem("second", "Episode two", "Series · S01 E02", 1, 2),
            PlayarrPlaybackQueueItem("third", "Episode three", "Series · S01 E03", 1, 3),
        )
        val queue = playarrPlaybackQueue("second", items)

        assertTrue(queue.canPrevious)
        assertTrue(queue.canNext)
        assertEquals("first", queue.move(-1).currentMediaFileId)
        assertEquals("third", queue.move(1).currentMediaFileId)
        assertEquals("first", queue.move(-10).currentMediaFileId)
        assertEquals("third", queue.move(10).currentMediaFileId)
        assertEquals("Episode two", queue.currentItem?.title)
        assertEquals(2, queue.currentItem?.episodeNumber)
        assertEquals("third", queue.select(2).currentMediaFileId)
        assertEquals(queue, queue.select(20))
    }

    @Test
    fun `standalone playback creates a one item queue`() {
        val queue = playarrPlaybackQueue("only", emptyList())

        assertEquals("only", queue.currentMediaFileId)
        assertEquals("Now playing", queue.currentItem?.title)
        assertFalse(queue.canPrevious)
        assertFalse(queue.canNext)
    }

    @Test
    fun `artist playback items retain web music context`() {
        val artist = Work(
            id = "artist",
            kind = WorkKind.Artist,
            title = "Artist name",
            sortTitle = "Artist name",
            addedAt = Instant.EPOCH,
            monitored = true,
            availability = Availability.Available,
        )
        val detail = WorkDetail(
            work = artist,
            children = WorkChildren.Artist(
                listOf(
                    AlbumDetail(
                        album = Album(
                            id = "album",
                            artistWorkId = artist.id,
                            title = "Album name",
                            albumType = AlbumType.Studio,
                            monitored = true,
                            availability = Availability.Available,
                        ),
                        tracks = listOf(
                            TrackDetail(
                                track = Track(
                                    id = "track",
                                    albumId = "album",
                                    discNumber = 1,
                                    trackNumber = 1,
                                    title = "Track name",
                                    availability = Availability.Available,
                                ),
                                mediaFileId = "media",
                            ),
                        ),
                    ),
                ),
            ),
        )

        val item = detail.playarrPlaybackQueueItems().single()

        assertEquals("media", item.mediaFileId)
        assertEquals("Track name", item.title)
        assertEquals("Artist name · Album name", item.subtitle)
        assertTrue(item.music)
        assertEquals("album", item.albumId)
        assertEquals(artist, item.artworkWork)
    }

    @Test
    fun `album artwork URL authenticates against the selected server`() {
        assertEquals(
            "https://media.example/api/v1/artwork/album/artist%20id/album%2Fid/poster",
            resolveAlbumArtworkUrl("https://media.example/", "artist id", "album/id"),
        )
    }

    @Test
    fun `album queue remains scoped to the selected album`() {
        val first = PlayarrPlaybackQueueItem("one", "One", music = true, albumId = "album-a")
        val second = PlayarrPlaybackQueueItem("two", "Two", music = true, albumId = "album-b")

        assertEquals(listOf(first), playarrAlbumPlaybackQueueItems(listOf(first, second), "album-a"))
    }

    @Test
    fun `music durations match Playarr Web formatting`() {
        assertEquals("3:07", formatMusicDuration(187))
        assertEquals("--:--", formatMusicDuration(null))
        assertEquals("--:--", formatMusicDuration(0))
    }

    @Test
    fun `music advances at the end only when another track exists`() {
        val music = PlayarrPlaybackQueueItem("one", "One", music = true)
        val video = PlayarrPlaybackQueueItem("movie", "Movie")

        assertTrue(shouldAutoAdvancePlayarrMusic(true, music, true))
        assertFalse(shouldAutoAdvancePlayarrMusic(true, music, false))
        assertFalse(shouldAutoAdvancePlayarrMusic(false, music, true))
        assertFalse(shouldAutoAdvancePlayarrMusic(true, video, true))
    }

    @Test
    fun `series browser keeps playable episodes in web season order`() {
        fun episode(id: String, seasonId: String, number: Int, mediaFileId: String?) = EpisodeDetail(
            episode = Episode(
                id = id,
                seasonId = seasonId,
                episodeNumber = number,
                title = "Episode $number",
                monitored = true,
                availability = if (mediaFileId == null) Availability.Pending else Availability.Available,
            ),
            mediaFileId = mediaFileId,
        )
        fun season(id: String, number: Int, episodes: List<EpisodeDetail>) = SeasonDetail(
            season = Season(
                id = id,
                seriesWorkId = "series",
                seasonNumber = number,
                monitored = true,
                availability = Availability.Available,
            ),
            episodes = episodes,
        )
        val series = WorkChildren.Series(
            listOf(
                season("s2", 2, listOf(episode("e2", "s2", 2, "media-2"), episode("e1", "s2", 1, "media-1"))),
                season("empty", 3, listOf(episode("missing", "empty", 1, null))),
                season("s1", 1, listOf(episode("pilot", "s1", 1, "pilot-media"))),
            ),
        )

        val playable = playarrPlayableSeasons(series)

        assertEquals(listOf(1, 2), playable.map { it.season.seasonNumber })
        assertEquals(listOf(1, 2), playable.last().episodes.map { it.episode.episodeNumber })
        assertTrue(playable.flatMap { it.episodes }.all { it.mediaFileId != null })
    }
}
