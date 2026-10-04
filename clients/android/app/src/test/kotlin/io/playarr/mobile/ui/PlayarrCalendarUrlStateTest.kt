package io.playarr.mobile.ui

import io.playarr.shared.data.model.CalendarEntry
import io.playarr.shared.data.model.CalendarEntrySource
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneOffset
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class PlayarrCalendarUrlStateTest {
    private val utc = ZoneOffset.UTC
    private fun d(v: String) = LocalDate.parse(v)

    @Test
    fun `every field round trips through one query string`() {
        val query = "view=agenda&date=2026-10-04&type=tv,movie&source=s1,s2&status=upcoming&from=2026-10-01&to=2026-10-31&monitored=1&selected=series%3Aw1%3A2026-10-10%3A12%3A00&panel=subscription"
        val state = parseCalendarQuery(query)
        assertEquals(CalendarViewMode.Agenda, state.view)
        assertEquals(d("2026-10-04"), state.date)
        assertEquals(setOf(CalendarType.Tv, CalendarType.Movie), state.filters.types)
        assertEquals("series:w1:2026-10-10:12:00", state.selected)
        assertEquals(CalendarPanel.Subscription, state.panel)
        assertEquals(5, state.filters.activeCount)
        assertEquals(query, state.toQuery())
        assertEquals(state, parseCalendarQuery(state.toQuery()))
    }

    @Test
    fun `junk is ignored, inverted ranges swap and empty state encodes to nothing`() {
        val state = parseCalendarQuery("view=year&date=nope&type=tv,bogus&status=x&from=2026-11-05&to=2026-11-01&panel=zzz")
        assertNull(state.view)
        assertNull(state.date)
        assertEquals(setOf(CalendarType.Tv), state.filters.types)
        assertTrue(state.filters.statuses.isEmpty())
        assertEquals(d("2026-11-01"), state.filters.from)
        assertEquals(d("2026-11-05"), state.filters.to)
        assertNull(state.panel)
        assertEquals("", CalendarUrlState().toQuery())
    }

    private fun entry(id: String, date: String, kind: String = "episode", hasFile: Boolean = false, monitored: Boolean = true, source: String = "s1") =
        CalendarEntry(
            id = id, mediaKind = kind, releaseType = "air", title = id, date = d(date),
            releaseAt = Instant.parse("${date}T12:00:00Z"), monitored = monitored, hasFile = hasFile,
            sources = listOf(CalendarEntrySource(source, "Src", "sonarr", 1)),
        )

    @Test
    fun `filters combine with AND across kinds and OR within one`() {
        val today = d("2026-10-05")
        val all = listOf(
            entry("past-missing", "2026-10-01"),
            entry("past-file", "2026-10-02", hasFile = true),
            entry("future", "2026-10-09", monitored = false),
            entry("movie", "2026-10-09", kind = "movie", source = "s2"),
        )
        fun ids(query: String) = applyCalendarFilters(all, parseCalendarQuery(query).filters, today, utc).map { it.id }
        assertEquals(listOf("movie"), ids("type=movie"))
        assertEquals(listOf("movie"), ids("source=s2"))
        assertEquals(listOf("past-missing"), ids("status=missing"))
        assertEquals(listOf("future", "movie"), ids("status=upcoming"))
        assertEquals(listOf("past-file"), ids("status=downloaded"))
        assertEquals(listOf("past-missing", "past-file", "movie"), ids("monitored=1"))
        assertEquals(listOf("past-file", "future"), ids("from=2026-10-02&to=2026-10-09&type=tv"))
        assertEquals(4, ids("").size)
        assertFalse(ids("status=aired,upcoming").isEmpty())
    }
}
