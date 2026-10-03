package io.playarr.mobile.ui

import org.junit.Assert.assertTrue
import org.junit.Test

class PlayarrHeroScrimTest {
    @Test
    fun descriptionTextMeetsAaOverWhiteBackdropInBothThemes() {
        try {
            for (dark in listOf(true, false)) {
                setPlayarrWebPalette(dark)
                val ratio = heroScrimWorstCaseContrast(WebInkSoft, WebSurface, HERO_SCRIM_TEXT_ALPHA)
                assertTrue("dark=$dark contrast $ratio", ratio >= 4.5f)
            }
        } finally {
            setPlayarrWebPalette(true)
        }
    }
}
