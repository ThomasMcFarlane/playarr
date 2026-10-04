package io.playarr.mobile.ui

import io.playarr.shared.data.model.ResumeAction
import io.playarr.shared.data.model.ResumeOption
import io.playarr.shared.data.model.ResumeOptionKind
import io.playarr.shared.data.model.ResumePlan
import java.time.ZoneOffset
import java.util.Locale
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class PlayarrResumeTest {
    private fun option(kind: ResumeOptionKind, id: String = "e") = ResumeOption(
        kind = kind,
        episodeId = id,
        mediaFileId = "m-$id",
        seasonNumber = 1,
        episodeNumber = 1,
        label = "S01E01",
    )

    private fun plan(action: ResumeAction) = ResumePlan(seriesWorkId = "s", action = action)

    @Test
    fun `each action maps to its own button label and title`() {
        assertEquals(PlayarrString.DetailStartSeries, plan(ResumeAction.Start).buttonLabel())
        assertEquals(PlayarrString.DetailResumeSeries, plan(ResumeAction.Resume).buttonLabel())
        assertEquals(PlayarrString.DetailWatchAgain, plan(ResumeAction.Restart).buttonLabel())
        assertEquals(PlayarrString.DetailStartSeriesTitle, plan(ResumeAction.Start).buttonTitle())
        assertEquals(PlayarrString.DetailResumeSeriesTitle, plan(ResumeAction.Resume).buttonTitle())
        assertEquals(PlayarrString.DetailWatchAgainTitle, plan(ResumeAction.Restart).buttonTitle())
    }

    @Test
    fun `every option kind has a distinct caption`() {
        val captions = ResumeOptionKind.entries.map { it.caption() }
        assertEquals(ResumeOptionKind.entries.size, captions.toSet().size)
    }

    @Test
    fun `stacked needs a choice and more than one option`() {
        val two = listOf(option(ResumeOptionKind.MissedEpisode, "a"), option(ResumeOptionKind.NextInSeries, "b"))
        assertTrue(ResumePlan("s", ResumeAction.Resume, needsChoice = true, options = two).isStacked)
        assertEquals(false, ResumePlan("s", ResumeAction.Resume, needsChoice = false, options = two).isStacked)
        assertEquals(false, ResumePlan("s", ResumeAction.Resume, needsChoice = true, options = two.take(1)).isStacked)
    }

    @Test
    fun `last watched dates are localised and bad stamps are rejected`() {
        val en = formatResumeDate("2026-10-04T12:00:00Z", Locale.ENGLISH, ZoneOffset.UTC)
        assertNotNull(en)
        assertTrue(en!!.contains("2026"))
        val ja = formatResumeDate("2026-10-04T12:00:00Z", Locale.JAPANESE, ZoneOffset.UTC)
        assertTrue(ja!!.contains("2026"))
        assertNull(formatResumeDate(null, Locale.ENGLISH))
        assertNull(formatResumeDate("", Locale.ENGLISH))
        assertNull(formatResumeDate("not a date", Locale.ENGLISH))
    }

    @Test
    fun `resume strings exist in every language`() {
        val keys = listOf(
            PlayarrString.DetailStartSeries,
            PlayarrString.DetailResumeSeries,
            PlayarrString.DetailWatchAgain,
            PlayarrString.ResumeChooserTitle,
            PlayarrString.ResumeKindUnfinished,
            PlayarrString.ResumeKindContinueFromLast,
            PlayarrString.HomeResumeOptions,
        )
        keys.forEach {
            assertTrue(it.english.isNotBlank() && it.thai.isNotBlank() && it.japanese.isNotBlank())
        }
    }
}
