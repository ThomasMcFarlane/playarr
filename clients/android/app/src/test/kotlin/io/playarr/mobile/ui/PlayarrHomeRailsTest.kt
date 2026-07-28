package io.playarr.mobile.ui

import io.playarr.shared.data.model.Availability
import io.playarr.shared.data.model.Episode
import io.playarr.shared.data.model.EpisodeDetail
import io.playarr.shared.data.model.Season
import io.playarr.shared.data.model.SeasonDetail
import io.playarr.shared.data.model.WatchProgress
import io.playarr.shared.data.model.WatchState
import io.playarr.shared.data.model.Work
import io.playarr.shared.data.model.WorkChildren
import io.playarr.shared.data.model.WorkDetail
import io.playarr.shared.data.model.WorkKind
import java.time.Instant
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test

class PlayarrHomeRailsTest {
    @Test
    fun `on deck is the only primary and preserves resolved progress order`() {
        val movie = work("movie", WorkKind.Movie, "2026-07-20T00:00:00Z")
        val series = work("series", WorkKind.Series, "2026-07-21T00:00:00Z")
        val rails = buildPlayarrHomeRails(
            mapOf(WorkKind.Movie to listOf(movie), WorkKind.Series to listOf(series)),
            listOf(
                PlayarrOnDeckEntry(series, progress(series.id, "2026-07-22T01:00:00Z")),
                PlayarrOnDeckEntry(movie, progress(movie.id, "2026-07-21T01:00:00Z")),
            ),
        )

        assertEquals(PlayarrString.HomeRailOnDeck, rails.first().title)
        assertEquals(listOf(series.id, movie.id), rails.first().works.map(Work::id))
        assertFalse(rails.any { it.title == PlayarrString.HomeRailStartWatching })
    }

    @Test
    fun `new and more shelves never repeat primary or each other`() {
        val movies = (1..25).map { work("movie-$it", WorkKind.Movie, "2026-07-${(26 - it).toString().padStart(2, '0')}T00:00:00Z") }
        val rails = buildPlayarrHomeRails(mapOf(WorkKind.Movie to movies), emptyList())
        val ids = rails.flatMap(HomeRail::works).map(Work::id)

        assertEquals(
            listOf(
                PlayarrString.HomeRailStartWatching,
                PlayarrString.HomeRailNewMovies,
                PlayarrString.HomeRailMoreMovies,
            ),
            rails.map(HomeRail::title),
        )
        assertEquals(ids.size, ids.distinct().size)
        assertEquals(25, ids.size)
    }

    @Test
    fun `artist catalog stays on Music and is not injected into Web home rails`() {
        val artist = work("artist", WorkKind.Artist, "2026-07-22T00:00:00Z")

        assertEquals(emptyList<HomeRail>(), buildPlayarrHomeRails(mapOf(WorkKind.Artist to listOf(artist)), emptyList()))
    }

    @Test
    fun `episodic on deck resolves exact child and rejects stale progress`() {
        val series = work("series", WorkKind.Series, "2026-07-21T00:00:00Z")
        val episode = EpisodeDetail(
            episode = Episode(
                id = "episode-3",
                seasonId = "season-2",
                episodeNumber = 3,
                title = "The Return",
                monitored = true,
                availability = Availability.Available,
            ),
            mediaFileId = "media-series",
        )
        val detail = WorkDetail(
            work = series,
            children = WorkChildren.Series(
                listOf(
                    SeasonDetail(
                        season = Season(
                            id = "season-2",
                            seriesWorkId = series.id,
                            seasonNumber = 2,
                            monitored = true,
                            availability = Availability.Available,
                        ),
                        episodes = listOf(episode),
                    ),
                ),
            ),
        )

        val resolved = resolvePlayarrOnDeckEntry(detail, progress(series.id, "2026-07-22T01:00:00Z"))
        assertEquals("The Return", resolved?.episode?.title)
        assertEquals(2, resolved?.episode?.seasonNumber)
        assertEquals(3, resolved?.episode?.episodeNumber)
        assertEquals(
            null,
            resolvePlayarrOnDeckEntry(
                detail,
                progress(series.id, "2026-07-22T01:00:00Z").copy(mediaFileId = "stale-media"),
            ),
        )
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
