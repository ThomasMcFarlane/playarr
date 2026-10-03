package io.playarr.mobile.ui

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class PlayarrHeroScrimTest {
    @Test
    fun descriptionTextMeetsAaOverFilteredArtworkInBothThemes() {
        try {
            for (dark in listOf(true, false)) {
                setPlayarrWebPalette(dark)
                val ratio = heroScrimWorstCaseContrast(WebInkSoft, WebSurface, HERO_SCRIM_TEXT_ALPHA, dark)
                assertTrue("dark=$dark contrast $ratio", ratio >= 4.5f)
            }
        } finally {
            setPlayarrWebPalette(true)
        }
    }

    @Test
    fun keyArtMatrixMatchesCssFilterChain() {
        // grayscale(1) contrast(.82) brightness(.6) of pure white, black and mid grey.
        for (gray in listOf(0f, 0.5f, 1f)) {
            val m = heroArtMatrix(WebGlass.ART_CONTRAST_DARK, WebGlass.ART_BRIGHTNESS_DARK)
            val viaMatrix = (m[0] + m[1] + m[2]) * gray + m[4] / 255f
            val viaCss = heroArtFilteredGray(gray, WebGlass.ART_CONTRAST_DARK, WebGlass.ART_BRIGHTNESS_DARK)
            assertEquals(viaCss, viaMatrix.coerceIn(0f, 1f), 0.001f)
        }
    }

    @Test
    fun boxBlurKeepsFlatColourAndSpreadsAnImpulse() {
        val w = 16
        val h = 12
        val flat = IntArray(w * h) { 0xFF3366CC.toInt() }
        assertTrue(boxBlurArgb(flat, w, h, 2).all { it == 0xFF3366CC.toInt() })

        val impulse = IntArray(w * h)
        impulse[6 * w + 8] = 0xFFFFFFFF.toInt()
        val blurred = boxBlurArgb(impulse, w, h, 2)
        val centre = blurred[6 * w + 8] and 0xFF
        val neighbour = blurred[6 * w + 10] and 0xFF
        assertTrue("centre $centre should be dimmer than 255", centre in 1..254)
        assertTrue("neighbour $neighbour should pick up energy", neighbour in 1 until 255)
    }

    @Test
    fun boxRadiusScalesWithDeviceSigma() {
        assertEquals(1, glassBoxRadius(8f))
        assertTrue(glassBoxRadius(66f) > glassBoxRadius(22f))
    }
}
