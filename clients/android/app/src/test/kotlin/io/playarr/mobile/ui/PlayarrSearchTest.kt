package io.playarr.mobile.ui

import io.playarr.shared.data.model.Availability
import io.playarr.shared.data.model.Playlist
import io.playarr.shared.data.model.PlaylistMediaType
import io.playarr.shared.data.model.Work
import io.playarr.shared.data.model.WorkKind
import java.time.Instant
import org.junit.Assert.assertEquals
import org.junit.Test

class PlayarrSearchTest {
    @Test
    fun `work results honor availability type and library together`() {
        val movie = work("movie", WorkKind.Movie)
        val series = work("series", WorkKind.Series)
        val unavailable = work("missing", WorkKind.Movie)

        assertEquals(
            listOf(movie),
            filterPlayarrSearchWorks(
                works = listOf(movie, series, unavailable),
                availableWorkIds = setOf("movie", "series"),
                mediaType = PlayarrSearchMediaType.Movie,
                libraryWorkIds = setOf("movie"),
            ),
        )
    }

    @Test
    fun `library filters suppress playlists and playlist filters suppress works`() {
        val playlist = Playlist(
            id = "playlist",
            name = "Friday Films",
            isSystem = false,
            mediaType = PlaylistMediaType.Video,
            createdAt = "now",
            updatedAt = "now",
        )

        assertEquals(
            emptyList<Playlist>(),
            filterPlayarrSearchPlaylists(
                listOf(playlist),
                query = "Friday",
                mediaType = PlayarrSearchMediaType.All,
                libraryId = "view-1",
            ),
        )
        assertEquals(
            emptyList<Work>(),
            filterPlayarrSearchWorks(
                works = listOf(work("movie", WorkKind.Movie)),
                availableWorkIds = setOf("movie"),
                mediaType = PlayarrSearchMediaType.Playlist,
            ),
        )
        val results = PlayarrSearchResults(listOf(work("movie", WorkKind.Movie)), listOf(playlist))
        assertEquals(2, results.count)
        assertEquals("work:movie", playarrSearchSelection(results, null))
        assertEquals("playlist:playlist", playarrSearchSelection(results, "playlist:playlist"))
        assertEquals("work:movie", playarrSearchSelection(results, "work:missing"))
    }

    private fun work(id: String, kind: WorkKind) = Work(
        id = id,
        kind = kind,
        externalRefs = emptyList(),
        title = id,
        sortTitle = id,
        overview = null,
        images = emptyList(),
        genres = emptyList(),
        tags = emptyList(),
        releaseDate = null,
        addedAt = Instant.parse("2026-07-22T00:00:00Z"),
        monitored = true,
        availability = Availability.Available,
    )
}
