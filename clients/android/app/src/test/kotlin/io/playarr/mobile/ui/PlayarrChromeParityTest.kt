package io.playarr.mobile.ui

import org.junit.Assert.assertEquals
import org.junit.Test

class PlayarrChromeParityTest {
    @Test
    fun `profile version uses the same visible label as Playarr Web`() {
        assertEquals("v0.1.0", profileVersionLabel("0.1.0"))
    }

    @Test
    fun `television profile tile shows the first name like the web rail`() {
        assertEquals("Device", tvProfileTileLabel("Device Test"))
        assertEquals("Ana", tvProfileTileLabel("  Ana  "))
        assertEquals("", tvProfileTileLabel(""))
    }
}
