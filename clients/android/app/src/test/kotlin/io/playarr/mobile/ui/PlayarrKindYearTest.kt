package io.playarr.mobile.ui

import java.time.Instant
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class PlayarrKindYearTest {
    @Test
    fun yearIsReadInUtc() {
        assertEquals(2019, playarrKindYear(Instant.parse("2019-12-31T23:00:00Z")))
    }

    @Test
    fun missingReleaseDateHasNoYear() {
        assertNull(playarrKindYear(null))
    }
}
