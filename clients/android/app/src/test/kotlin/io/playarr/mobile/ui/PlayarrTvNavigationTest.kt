package io.playarr.mobile.ui

import io.playarr.shared.data.model.Availability
import io.playarr.shared.data.model.Episode
import io.playarr.shared.data.model.EpisodeDetail
import io.playarr.shared.data.model.ResumeAction
import io.playarr.shared.data.model.ResumeOption
import io.playarr.shared.data.model.ResumeOptionKind
import io.playarr.shared.data.model.ResumePlan
import io.playarr.shared.data.model.Season
import io.playarr.shared.data.model.SeasonDetail
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test

/** The web TV navigation rules (useTvNavigation.ts, focusGeometry.ts, trackNavigation.ts), pinned as pure functions. */
class PlayarrTvNavigationTest {
    private val sameIndex: (Int, Int) -> Int = { _, _ -> 2 }

    @Test
    fun railLeftAndRightStepThroughTheRailAndStopAtTheEnd() {
        val sizes = listOf(5, 3)
        assertEquals(TvMove.Focus(0, 3), tvRailMove(0, 2, TvDirection.Right, sizes, sameIndex))
        assertEquals(TvMove.Focus(0, 1), tvRailMove(0, 2, TvDirection.Left, sizes, sameIndex))
        // RIGHT at the last card is a hard stop, LEFT at the first card leaves for the navigation rail.
        assertEquals(TvMove.Stay, tvRailMove(0, 4, TvDirection.Right, sizes, sameIndex))
        assertEquals(TvMove.LeftEdge, tvRailMove(0, 0, TvDirection.Left, sizes, sameIndex))
    }

    @Test
    fun railDownAndUpGoToTheNeighbouringRailAndNeverSideways() {
        val sizes = listOf(5, 3, 4)
        // Home keeps the card index and clamps it to the shorter rail.
        val keepIndex: (Int, Int) -> Int = { _, _ -> 4 }
        assertEquals(TvMove.Focus(1, 2), tvRailMove(0, 4, TvDirection.Down, sizes, keepIndex))
        assertEquals(TvMove.Focus(0, 4), tvRailMove(1, 2, TvDirection.Up, sizes, { _, _ -> 4 }))
        // Repeated DOWN walks every rail and then stays: the reported regression bounced between two cards of one rail.
        var rail = 0
        var index = 0
        val visited = mutableListOf(rail)
        repeat(6) {
            val move = tvRailMove(rail, index, TvDirection.Down, sizes) { _, _ -> index }
            if (move is TvMove.Focus) { rail = move.rail; index = move.index; visited += rail }
        }
        assertEquals(listOf(0, 1, 2), visited)
        assertEquals(TvMove.DownEdge, tvRailMove(2, 0, TvDirection.Down, sizes, sameIndex))
        assertEquals(TvMove.UpEdge, tvRailMove(0, 0, TvDirection.Up, sizes, sameIndex))
    }

    @Test
    fun emptyRailsAreSkipped() {
        assertEquals(TvMove.Focus(2, 0), tvRailMove(0, 0, TvDirection.Down, listOf(3, 0, 2)) { _, _ -> 0 })
        assertEquals(TvMove.Focus(0, 0), tvRailMove(2, 0, TvDirection.Up, listOf(3, 0, 2)) { _, _ -> 0 })
    }

    @Test
    fun gridNeighboursFollowTheWebTitleGrid() {
        // 3 columns, 7 cards: rows [0 1 2] [3 4 5] [6].
        assertEquals(1, tvGridNeighbour(0, 7, 3, TvDirection.Right))
        assertNull(tvGridNeighbour(2, 7, 3, TvDirection.Right))
        assertNull(tvGridNeighbour(0, 7, 3, TvDirection.Left))
        assertEquals(3, tvGridNeighbour(0, 7, 3, TvDirection.Down))
        assertEquals(0, tvGridNeighbour(3, 7, 3, TvDirection.Up))
        // DOWN onto an incomplete last row lands on the final card; DOWN from it leaves.
        assertEquals(6, tvGridNeighbour(5, 7, 3, TvDirection.Down))
        assertNull(tvGridNeighbour(6, 7, 3, TvDirection.Down))
        assertNull(tvGridNeighbour(1, 7, 3, TvDirection.Up))
    }

    @Test
    fun closestTileByCentreXPicksTheNearestColumn() {
        assertEquals(1, tvClosestByCentreX(listOf(100f, 300f, 500f), 280f))
        assertNull(tvClosestByCentreX(emptyList(), 10f))
    }

    @Test
    fun geometryRejectsTargetsOutsideTheForwardCone() {
        val card = TvRect(0f, 0f, 200f, 100f)
        val below = TvRect(0f, 200f, 200f, 300f)
        val farRightSameRow = TvRect(900f, 10f, 1100f, 110f)
        assertNotNull(tvScoreCandidate(card, below, TvDirection.Down))
        assertNull(tvScoreCandidate(card, farRightSameRow, TvDirection.Down))
        assertEquals(below, tvPickBest(card, listOf(farRightSameRow to farRightSameRow, below to below), TvDirection.Down))
    }

    private fun episode(id: String, number: Int, file: String?) = EpisodeDetail(
        Episode(id = id, seasonId = "s", episodeNumber = number, title = id, monitored = true, availability = Availability.Available),
        mediaFileId = file,
    )

    private fun season(number: Int, vararg episodes: EpisodeDetail) = SeasonDetail(
        Season(id = "season-$number", seriesWorkId = "series", seasonNumber = number, monitored = true, availability = Availability.Available),
        episodes.toList(),
    )

    private fun plan(episodeId: String, mediaFileId: String, workId: String = "series") = ResumePlan(
        seriesWorkId = workId,
        action = ResumeAction.Resume,
        target = ResumeOption(
            kind = ResumeOptionKind.Unfinished, episodeId = episodeId, mediaFileId = mediaFileId,
            seasonNumber = 2, episodeNumber = 1, label = "S02E01",
        ),
    )

    private val seasons = listOf(
        season(1, episode("e11", 1, "m11"), episode("e12", 2, "m12")),
        season(2, episode("e21", 1, "m21"), episode("e22", 2, null), episode("e23", 3, "m23")),
    )

    @Test
    fun seriesOpensOnTheResumePlansEpisodeAndSeason() {
        assertEquals(2 to "e21", playarrNextUpSelection(seasons, plan("e21", "m21"), "series"))
    }

    @Test
    fun seriesOpensOnTheFirstEpisodeWhenNothingWasWatched() {
        assertEquals(1 to "e11", playarrNextUpSelection(seasons, null, "series"))
    }

    @Test
    fun anotherSeriesPlanOrAnUnplayableTargetFallsBackToTheFirstEpisode() {
        assertEquals(1 to "e11", playarrNextUpSelection(seasons, plan("e21", "m21", workId = "other"), "series"))
        assertEquals(1 to "e11", playarrNextUpSelection(seasons, plan("e22", "gone"), "series"))
    }

    @Test
    fun theTargetIsFoundByMediaFileWhenTheEpisodeIdIsUnknown() {
        assertEquals(2 to "e23", playarrNextUpSelection(seasons, plan("unknown", "m23"), "series"))
    }

    @Test
    fun aSeriesWithNothingPlayableHasNoSelection() {
        assertNull(playarrNextUpSelection(listOf(season(1, episode("e1", 1, null))), null, "series"))
    }
}
