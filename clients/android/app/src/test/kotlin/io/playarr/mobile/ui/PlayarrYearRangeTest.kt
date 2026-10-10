package io.playarr.mobile.ui

import java.time.Instant
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class PlayarrYearRangeTest {
    @Test
    fun `year range follows the web label`() {
        val start = Instant.parse("2011-09-19T00:00:00Z")
        assertEquals("2011", playarrYearRange(start, null))
        assertEquals("2011", playarrYearRange(start, Instant.parse("2011-12-01T00:00:00Z")))
        assertEquals("2011–2017", playarrYearRange(start, Instant.parse("2017-04-17T00:00:00Z")))
        assertNull(playarrYearRange(null, Instant.parse("2017-04-17T00:00:00Z")))
    }
}
