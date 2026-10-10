package io.playarr.mobile.ui

import org.junit.Assert.assertEquals
import org.junit.Test

class PlayarrPosterCardWidthTest {
    @Test
    fun `television poster card follows the web card width per artwork size`() {
        assertEquals(327.2f, tvPosterCardWidth(LibraryArtworkSize.Medium, cover = false).value, 0.05f)
        assertEquals(191.33f, tvPosterCardWidth(LibraryArtworkSize.Medium, cover = true).value, 0.05f)
        assertEquals(238.92f, tvPosterCardWidth(LibraryArtworkSize.Small, cover = false).value, 0.05f)
        assertEquals(503.76f, tvPosterCardWidth(LibraryArtworkSize.Large, cover = false).value, 0.05f)
    }
}
