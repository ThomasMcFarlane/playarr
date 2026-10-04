package io.playarr.mobile.ui

import io.playarr.shared.data.model.CalendarEntry
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneOffset
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class PlayarrCalendarGroupingTest {
    private val utc = ZoneOffset.UTC

    private fun ep(n: Long, season: Long = 2, id: String = "ep$n", title: String = "The Show", work: String? = "w1",
                   at: String? = "2026-10-10T12:00:00Z", kind: String = "episode", numbered: Boolean = true) =
        CalendarEntry(
            id = id, mediaKind = kind, releaseType = "air", title = title, date = LocalDate.parse("2026-10-10"),
            releaseAt = at?.let(Instant::parse), workId = work,
            seasonNumber = season.takeIf { numbered }, episodeNumber = n.takeIf { numbered },
        )

    @Test
    fun `episode codes collapse contiguous runs and list gaps`() {
        assertEquals("S02E04–E06", formatEpisodeCodes(listOf(ep(4), ep(5), ep(6))))
        assertEquals("S02E01, E03, E05", formatEpisodeCodes(listOf(ep(1), ep(3), ep(5))))
        assertEquals("S02E01–E02, E04", formatEpisodeCodes(listOf(ep(1), ep(2), ep(4))))
        assertEquals("S01E10, S02E01", formatEpisodeCodes(listOf(ep(10, season = 1), ep(1))))
    }

    @Test
    fun `same series same day and slot groups, everything else stays individual`() {
        val items = groupSeriesEpisodes(
            listOf(
                ep(6), ep(4), ep(5),
                ep(1, id = "other", title = "Other Show", work = "w2"),
                ep(1, id = "movie", kind = "movie", numbered = false),
                ep(7, id = "late", at = "2026-10-10T20:00:00Z"),
                ep(8, id = "unnumbered", numbered = false),
            ),
            utc,
        )
        assertEquals(5, items.size)
        val group = items.first() as CalendarItem.Series
        assertEquals("S02E04–E06", group.codes)
        assertEquals(listOf("ep4", "ep5", "ep6"), group.entries.map { it.id })
        assertTrue(items.drop(1).all { it is CalendarItem.Single })
    }

    @Test
    fun `all-day episodes of one series group together`() {
        val items = groupSeriesEpisodes(listOf(ep(1, at = null), ep(2, at = null)), utc)
        assertEquals(1, items.size)
        assertEquals("S02E01–E02", (items.single() as CalendarItem.Series).codes)
    }
}
