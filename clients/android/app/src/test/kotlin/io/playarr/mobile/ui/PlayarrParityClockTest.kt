package io.playarr.mobile.ui

import java.time.Instant
import java.time.LocalDate
import java.time.ZoneOffset
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Test

class PlayarrParityClockTest {
    @After fun reset() { parityClock = null }

    @Test
    fun `the parity clock freezes today and the time of day`() {
        parityClock = Instant.parse("2026-10-07T12:00:00Z")
        assertEquals(LocalDate.of(2026, 10, 7), playarrToday(ZoneOffset.UTC))
        assertEquals("12:00", playarrNow(ZoneOffset.UTC).toLocalTime().toString())
    }

    @Test
    fun `without the hook the real clock is used`() {
        parityClock = null
        assertEquals(LocalDate.now(ZoneOffset.UTC), playarrToday(ZoneOffset.UTC))
    }
}
