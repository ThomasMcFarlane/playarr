package io.streamarr.mobile.ui

import io.streamarr.shared.data.model.Album
import io.streamarr.shared.data.model.AlbumDetail
import io.streamarr.shared.data.model.AlbumType
import io.streamarr.shared.data.model.Availability
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
}
