package io.streamarr.mobile.ui

import org.junit.Assert.assertEquals
import org.junit.Test

class PlayarrChromeParityTest {
    @Test
    fun `profile version uses the same visible label as Playarr Web`() {
        assertEquals("v0.1.0", profileVersionLabel("0.1.0"))
    }
}
