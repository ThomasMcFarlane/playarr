package io.playarr.mobile.ui

import org.junit.Assert.assertEquals
import org.junit.Test

class PlayarrPageHeaderLayoutTest {
    @Test
    fun `month and year jump targets the first day of the month`() {
        assertEquals(java.time.LocalDate.of(2027, 2, 1), calendarJumpTarget(2027, 2))
        assertEquals(java.time.LocalDate.of(2027, 12, 1), calendarJumpTarget(2027, 99))
    }
}
