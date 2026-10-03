package io.playarr.mobile.ui

import io.playarr.shared.data.model.CalendarEntry
import io.playarr.shared.data.model.CalendarMediaKind
import io.playarr.shared.data.model.CalendarSourceStatus
import java.time.DayOfWeek
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.util.Locale
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class PlayarrCalendarLogicTest {
    private fun d(value: String) = LocalDate.parse(value)

    private fun entry(
        id: String,
        date: String,
        title: String = id,
        kind: String = "episode",
        releaseAt: String? = null,
        monitored: Boolean = false,
        hasFile: Boolean = false,
        season: Long? = null,
        episode: Long? = null,
    ) = CalendarEntry(
        id = id,
        mediaKind = kind,
        releaseType = "air",
        title = title,
        date = d(date),
        releaseAt = releaseAt?.let(Instant::parse),
        monitored = monitored,
        hasFile = hasFile,
        seasonNumber = season,
        episodeNumber = episode,
    )

    @Test
    fun `agenda window matches the server default of today plus thirty days`() {
        val window = calendarWindow(CalendarViewMode.Agenda, d("2026-10-04"), DayOfWeek.MONDAY)
        assertEquals(CalendarWindow(d("2026-10-04"), d("2026-11-03")), window)
        assertTrue(window.days.size.toLong() <= CALENDAR_MAX_SPAN_DAYS)
    }

    @Test
    fun `week window starts on the locale first day`() {
        // 2026-10-04 is a Sunday.
        assertEquals(
            CalendarWindow(d("2026-09-28"), d("2026-10-04")),
            calendarWindow(CalendarViewMode.Week, d("2026-10-04"), DayOfWeek.MONDAY),
        )
        assertEquals(
            CalendarWindow(d("2026-10-04"), d("2026-10-10")),
            calendarWindow(CalendarViewMode.Week, d("2026-10-04"), DayOfWeek.SUNDAY),
        )
    }

    @Test
    fun `month window is a whole number of weeks covering the month and stays within the server cap`() {
        val monday = calendarWindow(CalendarViewMode.Month, d("2026-10-01"), DayOfWeek.MONDAY)
        assertEquals(CalendarWindow(d("2026-09-28"), d("2026-11-01")), monday)
        val sunday = calendarWindow(CalendarViewMode.Month, d("2026-10-01"), DayOfWeek.SUNDAY)
        assertEquals(CalendarWindow(d("2026-09-27"), d("2026-10-31")), sunday)
        listOf(DayOfWeek.MONDAY, DayOfWeek.SATURDAY, DayOfWeek.SUNDAY).forEach { first ->
            for (month in 1..12) {
                val window = calendarWindow(CalendarViewMode.Month, LocalDate.of(2026, month, 1), first)
                assertEquals(0, window.days.size % 7)
                assertEquals(first, window.start.dayOfWeek)
                assertTrue(window.days.size <= 42)
                assertEquals(window.days.size / 7, calendarGridRows(window).size)
            }
        }
    }

    @Test
    fun `shifting moves one page and never overlaps or skips agenda days`() {
        val start = d("2026-10-04")
        val next = shiftCalendarAnchor(CalendarViewMode.Agenda, start, 1)
        val firstEnd = calendarWindow(CalendarViewMode.Agenda, start, DayOfWeek.MONDAY).end
        assertEquals(firstEnd.plusDays(1), next)
        assertEquals(start, shiftCalendarAnchor(CalendarViewMode.Agenda, next, -1))
        assertEquals(d("2026-10-11"), shiftCalendarAnchor(CalendarViewMode.Week, start, 1))
        assertEquals(d("2026-11-01"), shiftCalendarAnchor(CalendarViewMode.Month, d("2026-10-17"), 1))
        assertEquals(d("2026-09-01"), shiftCalendarAnchor(CalendarViewMode.Month, d("2026-10-17"), -1))
        assertEquals(d("2027-01-01"), shiftCalendarAnchor(CalendarViewMode.Month, d("2026-12-01"), 1))
    }

    @Test
    fun `today anchor snaps month view to the first of the month`() {
        assertEquals(d("2026-10-01"), todayAnchor(CalendarViewMode.Month, d("2026-10-17")))
        assertEquals(d("2026-10-17"), todayAnchor(CalendarViewMode.Agenda, d("2026-10-17")))
    }

    @Test
    fun `titles are localised with the device locale`() {
        val window = calendarWindow(CalendarViewMode.Month, d("2026-10-01"), DayOfWeek.MONDAY)
        assertEquals("October 2026", calendarWindowTitle(CalendarViewMode.Month, d("2026-10-01"), window, Locale.UK))
        assertEquals("octobre 2026", calendarWindowTitle(CalendarViewMode.Month, d("2026-10-01"), window, Locale.FRANCE))
        val agenda = calendarWindow(CalendarViewMode.Agenda, d("2026-10-04"), DayOfWeek.MONDAY)
        val title = calendarWindowTitle(CalendarViewMode.Agenda, d("2026-10-04"), agenda, Locale.UK)
        assertTrue(title, title.startsWith("4 Oct 2026") && title.endsWith("3 Nov 2026"))
    }

    @Test
    fun `grouping orders days and entries and drops nothing`() {
        val window = calendarWindow(CalendarViewMode.Agenda, d("2026-10-04"), DayOfWeek.MONDAY)
        val groups = groupCalendarEntries(
            listOf(
                entry("b", "2026-10-06", title = "Beta"),
                entry("a2", "2026-10-05", title = "Alpha", season = 1, episode = 2),
                entry("a1", "2026-10-05", title = "Alpha", season = 1, episode = 1),
                entry("timed", "2026-10-05", title = "Zulu", releaseAt = "2026-10-05T01:00:00Z"),
            ),
            kinds = emptySet(),
            window = window,
            fillEmptyDays = false,
        )
        assertEquals(listOf(d("2026-10-05"), d("2026-10-06")), groups.map { it.date })
        assertEquals(listOf("timed", "a1", "a2"), groups[0].entries.map { it.id })
        assertEquals(4, groups.sumOf { it.entries.size })
    }

    @Test
    fun `week grouping fills empty days and the kind filter keeps unknown kinds visible`() {
        val window = calendarWindow(CalendarViewMode.Week, d("2026-10-05"), DayOfWeek.MONDAY)
        val entries = listOf(
            entry("ep", "2026-10-06", kind = "episode"),
            entry("mv", "2026-10-07", kind = "movie"),
            entry("new", "2026-10-07", kind = "podcast"),
        )
        val all = groupCalendarEntries(entries, emptySet(), window, fillEmptyDays = true)
        assertEquals(7, all.size)
        assertTrue(all.first().entries.isEmpty())

        val moviesOnly = groupCalendarEntries(entries, setOf(CalendarMediaKind.Movie), window, fillEmptyDays = true)
        assertEquals(listOf("mv", "new"), moviesOnly.flatMap { it.entries }.map { it.id })
        assertEquals(mapOf(d("2026-10-07") to 2), calendarEntryCountsByDay(entries, setOf(CalendarMediaKind.Movie)))
    }

    @Test
    fun `library state prefers in library over monitored`() {
        assertEquals(CalendarLibraryState.InLibrary, entry("1", "2026-10-05", hasFile = true, monitored = true).libraryState())
        assertEquals(CalendarLibraryState.Monitored, entry("2", "2026-10-05", monitored = true).libraryState())
        assertEquals(CalendarLibraryState.NotMonitored, entry("3", "2026-10-05").libraryState())
    }

    @Test
    fun `episode code needs both numbers`() {
        assertEquals("S01E02", entry("1", "2026-10-05", season = 1, episode = 2).episodeCode())
        assertEquals("S12E103", entry("1", "2026-10-05", season = 12, episode = 103).episodeCode())
        assertNull(entry("2", "2026-10-05", season = 1).episodeCode())
    }

    @Test
    fun `failed sources are surfaced and ok ones are not`() {
        val sources = listOf(
            CalendarSourceStatus("1", "Sonarr", "sonarr", "ok", null, 4),
            CalendarSourceStatus("2", "Radarr", "radarr", "unreachable", "timed out", 0),
            CalendarSourceStatus("3", "Lidarr", "lidarr", "rejected", null, 0),
            CalendarSourceStatus("4", "Readarr", "readarr", "error", "boom", 0),
        )
        assertEquals(listOf("Radarr", "Lidarr", "Readarr"), failedCalendarSources(sources).map { it.name })
    }

    @Test
    fun `release time is shown in the device zone and absent for all-day entries`() {
        val timed = entry("1", "2026-10-05", releaseAt = "2026-10-05T23:30:00Z")
        val london = timed.localReleaseTime(ZoneId.of("Europe/London"), Locale.UK)
        val tokyo = timed.localReleaseTime(ZoneId.of("Asia/Tokyo"), Locale.UK)
        assertTrue(london, london!!.contains("6 Oct 2026") && london.contains("00:30"))
        assertTrue(tokyo, tokyo!!.contains("6 Oct 2026") && tokyo.contains("08:30"))
        assertNull(entry("2", "2026-10-05").localReleaseTime(ZoneId.of("UTC"), Locale.UK))
    }

    @Test
    fun `lag is rounded to the most natural unit`() {
        assertEquals(LagDuration(LagUnit.Minutes, 1), lagDuration(10))
        assertEquals(LagDuration(LagUnit.Minutes, 45), lagDuration(45 * 60L))
        assertEquals(LagDuration(LagUnit.Hours, 1), lagDuration(3_600))
        assertEquals(LagDuration(LagUnit.Hours, 36), lagDuration(36 * 3_600L))
        assertEquals(LagDuration(LagUnit.Days, 2), lagDuration(48 * 3_600L))
        assertEquals(LagDuration(LagUnit.Days, 7), lagDuration(7 * 24 * 3_600L))
        assertEquals(LagDuration(LagUnit.Minutes, 1), lagDuration(-5))
    }
}
