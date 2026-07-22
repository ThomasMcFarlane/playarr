package io.streamarr.mobile.ui

import io.streamarr.shared.data.model.Availability
import io.streamarr.shared.data.model.WatchProgress
import io.streamarr.shared.data.model.WatchState
import io.streamarr.shared.data.model.Work
import io.streamarr.shared.data.model.WorkKind
import java.time.Instant
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test

class PlayarrHomeRailsTest {
    @Test
    fun `on deck is the only primary and follows latest progress order`() {
        val movie = work("movie", WorkKind.Movie, "2026-07-20T00:00:00Z")
        val series = work("series", WorkKind.Series, "2026-07-21T00:00:00Z")
        val rails = buildPlayarrHomeRails(
            mapOf(WorkKind.Movie to listOf(movie), WorkKind.Series to listOf(series)),
            listOf(
                progress(movie.id, "2026-07-21T01:00:00Z"),
                progress(series.id, "2026-07-22T01:00:00Z"),
            ),
        )

        assertEquals("On deck", rails.first().title)
        assertEquals(listOf(series.id, movie.id), rails.first().works.map(Work::id))
        assertFalse(rails.any { it.title == "Start watching" })
    }

    @Test
    fun `new and more shelves never repeat primary or each other`() {
        val movies = (1..25).map { work("movie-$it", WorkKind.Movie, "2026-07-${(26 - it).toString().padStart(2, '0')}T00:00:00Z") }
        val rails = buildPlayarrHomeRails(mapOf(WorkKind.Movie to movies), emptyList())
        val ids = rails.flatMap(HomeRail::works).map(Work::id)

        assertEquals(listOf("Start watching", "New movies", "More movies"), rails.map(HomeRail::title))
        assertEquals(ids.size, ids.distinct().size)
        assertEquals(25, ids.size)
    }

    @Test
    fun `artist catalog stays on Music and is not injected into Web home rails`() {
        val artist = work("artist", WorkKind.Artist, "2026-07-22T00:00:00Z")

        assertEquals(emptyList<HomeRail>(), buildPlayarrHomeRails(mapOf(WorkKind.Artist to listOf(artist)), emptyList()))
    }

    private fun work(id: String, kind: WorkKind, addedAt: String) = Work(
        id = id,
        kind = kind,
        title = id,
        sortTitle = id,
        addedAt = Instant.parse(addedAt),
        monitored = true,
        availability = Availability.Available,
    )

    private fun progress(workId: String, updatedAt: String) = WatchProgress(
        mediaFileId = "media-$workId",
        workId = workId,
        positionMs = 5_000L,
        durationMs = 10_000L,
        state = WatchState.PartWatched,
        updatedAt = updatedAt,
    )
}
