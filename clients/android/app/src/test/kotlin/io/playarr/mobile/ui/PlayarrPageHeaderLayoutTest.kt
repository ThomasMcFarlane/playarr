package io.playarr.mobile.ui

import org.junit.Assert.assertEquals
import org.junit.Test

class PlayarrPageHeaderLayoutTest {
    // Television header measured against the clock: reserved area starts at 478 dp - 154 dp inset = 324.
    private val reserved = 324

    @Test
    fun `a short breadcrumb stays inline when it fits before the clock`() {
        // "Movies" ends at 180, "400 TITLES" is 62 wide, divider 45.
        assertEquals(PlayarrSubtitlePlacement.Inline, decideSubtitlePlacement(true, 180, 62, 45, reserved))
    }

    @Test
    fun `a long title or breadcrumb wraps beneath the title instead of running under the clock`() {
        assertEquals(PlayarrSubtitlePlacement.Wrapped, decideSubtitlePlacement(true, 313, 62, 45, reserved))
        assertEquals(PlayarrSubtitlePlacement.Wrapped, decideSubtitlePlacement(true, 180, 300, 45, reserved))
    }

    @Test
    fun `no breadcrumb means no placement and phones have no clock to avoid`() {
        assertEquals(PlayarrSubtitlePlacement.None, decideSubtitlePlacement(false, 100, 0, 45, reserved))
        assertEquals(PlayarrSubtitlePlacement.Inline, decideSubtitlePlacement(true, 400, 500, 24, null))
    }

    @Test
    fun `month and year jump targets the first day of the month`() {
        assertEquals(java.time.LocalDate.of(2027, 2, 1), calendarJumpTarget(2027, 2))
        assertEquals(java.time.LocalDate.of(2027, 12, 1), calendarJumpTarget(2027, 99))
    }
}
