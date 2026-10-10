package io.playarr.mobile.ui

import io.playarr.shared.data.model.CalendarEntry
import java.time.LocalDate
import java.time.ZoneOffset
import org.junit.Assert.assertEquals
import org.junit.Test

class PlayarrCalendarToneTest {
    private val today = LocalDate.parse("2026-10-07")
    private fun entry(date: String, hasFile: Boolean = false, monitored: Boolean = false) = CalendarEntry(
        id = "e$date$hasFile$monitored", mediaKind = "episode", releaseType = "air", title = "Sample Series 1",
        date = LocalDate.parse(date), hasFile = hasFile, monitored = monitored,
    )

    @Test
    fun `entry tone follows web entryPillTone`() {
        assertEquals(CalendarPillTone.Available, calendarEntryTone(entry("2026-10-09", hasFile = true), today, ZoneOffset.UTC))
        assertEquals(CalendarPillTone.Upcoming, calendarEntryTone(entry("2026-10-08", monitored = true), today, ZoneOffset.UTC))
        assertEquals(CalendarPillTone.Missing, calendarEntryTone(entry("2026-10-07", monitored = true), today, ZoneOffset.UTC))
        assertEquals(CalendarPillTone.Neutral, calendarEntryTone(entry("2026-10-06"), today, ZoneOffset.UTC))
    }

    @Test
    fun `a single release takes its own tone`() {
        assertEquals(CalendarPillTone.Missing, calendarItemTone(CalendarItem.Single(entry("2026-10-01", monitored = true)), today, ZoneOffset.UTC))
    }
}
