package io.playarr.mobile.ui

import io.playarr.shared.data.model.CalendarAction
import io.playarr.shared.data.model.CalendarEntry
import java.time.LocalDate
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class PlayarrCalendarFocusTest {
    private fun entry(hasFile: Boolean, vararg actions: CalendarAction, kind: String = "episode") = CalendarEntry(
        id = "e", mediaKind = kind, releaseType = "air", title = "Sample Series 1",
        date = LocalDate.parse("2026-10-07"), hasFile = hasFile, actions = actions.toList(),
    )

    @Test
    fun weekLeftRightMovesBetweenDaysAndUpDownBetweenEntries() {
        val columns = listOf(2, 0, 3, 1)
        val from = CalendarSlot(0, 1)
        assertEquals(CalendarSlot(2, 1), calendarWeekNeighbour(columns, from, CalendarKey.Right))
        assertEquals(CalendarSlot(3, 0), calendarWeekNeighbour(columns, CalendarSlot(2, 2), CalendarKey.Right))
        assertEquals(CalendarSlot(0, 1), calendarWeekNeighbour(columns, CalendarSlot(2, 1), CalendarKey.Left))
        assertNull(calendarWeekNeighbour(columns, CalendarSlot(0, 0), CalendarKey.Left))
        assertNull(calendarWeekNeighbour(columns, CalendarSlot(3, 0), CalendarKey.Right))
        assertEquals(CalendarSlot(2, 2), calendarWeekNeighbour(columns, CalendarSlot(2, 1), CalendarKey.Down))
        assertNull(calendarWeekNeighbour(columns, CalendarSlot(2, 2), CalendarKey.Down))
        assertEquals(CalendarSlot(2, 0), calendarWeekNeighbour(columns, CalendarSlot(2, 1), CalendarKey.Up))
        assertNull(calendarWeekNeighbour(columns, CalendarSlot(2, 0), CalendarKey.Up))
    }

    @Test
    fun monthGridMovesByCellAndWeek() {
        assertEquals(9, calendarMonthNeighbour(8, 5, 7, CalendarKey.Right))
        assertEquals(7, calendarMonthNeighbour(8, 5, 7, CalendarKey.Left))
        assertEquals(15, calendarMonthNeighbour(8, 5, 7, CalendarKey.Down))
        assertEquals(1, calendarMonthNeighbour(8, 5, 7, CalendarKey.Up))
        assertNull(calendarMonthNeighbour(6, 5, 7, CalendarKey.Right))
        assertNull(calendarMonthNeighbour(7, 5, 7, CalendarKey.Left))
        assertNull(calendarMonthNeighbour(3, 5, 7, CalendarKey.Up))
        assertNull(calendarMonthNeighbour(30, 5, 7, CalendarKey.Down))
    }

    @Test
    fun listMovesUpAndDownOnly() {
        assertEquals(2, calendarListNeighbour(1, 4, CalendarKey.Down))
        assertEquals(0, calendarListNeighbour(1, 4, CalendarKey.Up))
        assertNull(calendarListNeighbour(0, 4, CalendarKey.Up))
        assertNull(calendarListNeighbour(3, 4, CalendarKey.Down))
        assertNull(calendarListNeighbour(1, 4, CalendarKey.Left))
    }

    @Test
    fun farEdgesAreConsumedAndNearEdgesLeaveTheGrid() {
        assertTrue(calendarConsumesAtEdge(CalendarKey.Down))
        assertTrue(calendarConsumesAtEdge(CalendarKey.Right))
        assertFalse(calendarConsumesAtEdge(CalendarKey.Up))
        assertFalse(calendarConsumesAtEdge(CalendarKey.Left))
    }

    @Test
    fun availabilityIsAFilePlayableByTheViewerNeverTheKind() {
        assertFalse(entry(false).isAvailable())
        assertTrue(entry(true).isAvailable())
        assertTrue(entry(true, CalendarAction(CalendarAction.PLAY, enabled = true)).isAvailable())
        assertTrue(entry(true, CalendarAction(CalendarAction.RESUME, enabled = true)).isAvailable())
        assertFalse(entry(true, CalendarAction(CalendarAction.PLAY, enabled = false)).isAvailable())
        assertFalse(entry(true, CalendarAction(CalendarAction.OPEN, enabled = true)).isAvailable())
        for (kind in listOf("episode", "movie", "album", "book")) {
            assertTrue(entry(true, kind = kind).isAvailable())
            assertFalse(entry(false, kind = kind).isAvailable())
        }
    }

    @Test
    fun seriesGroupIsAvailableOnlyWhenEveryEpisodeIs() {
        val have = entry(true)
        val lack = entry(false)
        assertTrue(CalendarItem.Series("k", "S", listOf(have, have), "S01E01").isAvailable())
        assertFalse(CalendarItem.Series("k", "S", listOf(have, lack), "S01E01").isAvailable())
    }

    @Test
    fun monthChipsMoveAlongTheWeekRowAndThroughCells() {
        // two weeks of seven cells; slots per cell
        val slots = listOf(2, 0, 1, 3, 0, 0, 0, 1, 0, 0, 2, 0, 0, 0)
        // Right skips the empty cell and clamps the slot
        assertEquals(CalendarSlot(2, 0), calendarMonthChipNeighbour(slots, 7, CalendarSlot(0, 1), CalendarKey.Right))
        // Left from the first populated cell has nowhere to go
        assertNull(calendarMonthChipNeighbour(slots, 7, CalendarSlot(0, 0), CalendarKey.Left))
        // Right never wraps to the next week
        assertNull(calendarMonthChipNeighbour(slots, 7, CalendarSlot(3, 0), CalendarKey.Right))
        // Down inside a cell, then on to the next populated cell in the column
        assertEquals(CalendarSlot(3, 1), calendarMonthChipNeighbour(slots, 7, CalendarSlot(3, 0), CalendarKey.Down))
        assertEquals(CalendarSlot(10, 0), calendarMonthChipNeighbour(slots, 7, CalendarSlot(3, 2), CalendarKey.Down))
        assertEquals(CalendarSlot(3, 2), calendarMonthChipNeighbour(slots, 7, CalendarSlot(10, 0), CalendarKey.Up))
        assertNull(calendarMonthChipNeighbour(slots, 7, CalendarSlot(0, 0), CalendarKey.Up))
    }
}
