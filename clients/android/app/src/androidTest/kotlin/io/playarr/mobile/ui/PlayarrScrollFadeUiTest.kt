package io.playarr.mobile.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.items
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.captureToImage
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.unit.dp
import io.playarr.shared.designsystem.component.LocalPlayarrDarkTheme
import io.playarr.shared.designsystem.component.LocalPlayarrFadeBackground
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

/** A rail shows the web edge fade on a side only while cards continue beyond it, in both themes. */
class PlayarrScrollFadeUiTest {
    @get:Rule
    val compose = createComposeRule()

    private fun luminance(argb: Int): Double {
        val r = (argb shr 16) and 0xFF
        val g = (argb shr 8) and 0xFF
        val b = argb and 0xFF
        return 0.2126 * r + 0.7152 * g + 0.0722 * b
    }

    private fun check(dark: Boolean) {
        val state = LazyListState()
        compose.setContent {
            CompositionLocalProvider(LocalPlayarrDarkTheme provides dark, LocalPlayarrFadeBackground provides Color(0xFF151315)) {
                PlayarrLazyRow(
                    modifier = Modifier.testTag("rail").width(600.dp).height(120.dp),
                    state = state,
                ) {
                    items(30) { Box(Modifier.width(100.dp).fillMaxHeight().background(Color(0xFFE8E8E8))) }
                }
            }
        }
        compose.waitForIdle()
        fun edges(): Pair<Double, Double> {
            val bitmap = compose.onNodeWithTag("rail").captureToImage().asAndroidBitmap()
            val y = bitmap.height / 2
            return luminance(bitmap.getPixel(2, y)) to luminance(bitmap.getPixel(bitmap.width - 3, y))
        }
        val interior = luminance(0xFFE8E8E8.toInt())
        val atStart = edges()
        // Not scrolled: nothing before the first card, so the left edge is untouched; cards continue on the right.
        assertEquals("no left fade at the start (dark=$dark)", interior, atStart.first, 1.0)
        assertTrue("right fade while cards continue (dark=$dark): ${atStart.second}", atStart.second < interior - 20)
        compose.runOnIdle { kotlinx.coroutines.runBlocking { state.scrollToItem(8) } }
        compose.waitForIdle()
        val mid = edges()
        assertTrue("left fade once scrolled (dark=$dark): ${mid.first}", mid.first < interior - 20)
        assertTrue("right fade still shows (dark=$dark): ${mid.second}", mid.second < interior - 20)
        compose.runOnIdle { kotlinx.coroutines.runBlocking { state.scrollToItem(29) } }
        compose.waitForIdle()
        val end = edges()
        assertTrue("left fade at the end (dark=$dark)", end.first < interior - 20)
        assertEquals("no right fade after the last card (dark=$dark)", interior, end.second, 1.0)
    }

    @Test
    fun railFadesOnBothSidesWhereCardsContinueInTheDarkTheme() = check(dark = true)

    @Test
    fun railFadesOnBothSidesWhereCardsContinueInTheLightTheme() = check(dark = false)

    /** Web `.tv-media-track`: scrolled-past cards fade over the gutter only; the card on the start line stays clear. */
    private fun checkGutter(dark: Boolean) {
        val state = LazyListState()
        compose.setContent {
            CompositionLocalProvider(LocalPlayarrDarkTheme provides dark, LocalPlayarrFadeBackground provides Color(0xFF151315)) {
                PlayarrLazyRow(
                    modifier = Modifier.testTag("rail").width(700.dp).height(120.dp),
                    state = state,
                    startGutter = 150.dp,
                    contentPadding = androidx.compose.foundation.layout.PaddingValues(start = 150.dp),
                ) {
                    items(30) { Box(Modifier.width(100.dp).fillMaxHeight().background(Color(0xFFE8E8E8))) }
                }
            }
        }
        compose.waitForIdle()
        val interior = luminance(0xFFE8E8E8.toInt())
        fun sample(x: Int): Double {
            val bitmap = compose.onNodeWithTag("rail").captureToImage().asAndroidBitmap()
            return luminance(bitmap.getPixel(x, bitmap.height / 2))
        }
        val density = compose.density
        val startLine = with(density) { 150.dp.roundToPx() }
        // At rest the first card sits on the start line, untouched.
        assertEquals("first card clear at rest (dark=$dark)", interior, sample(startLine + 10), 1.0)
        compose.runOnIdle { kotlinx.coroutines.runBlocking { state.scrollToItem(6) } }
        compose.waitForIdle()
        // Scrolled: cards in the gutter fade (nearly gone at the far left); the card just right of the start line is clear.
        // (The test surface behind the rail is white, so a card faded to nothing reads brighter than the card colour.)
        val edge = Math.abs(sample(3) - interior)
        val half = Math.abs(sample(startLine / 2) - interior)
        assertTrue("gutter edge faded (dark=$dark): $edge", edge > 10)
        assertTrue("gutter fades gradually (dark=$dark): $half vs $edge", half > 3 && half < edge)
        assertEquals("card past the gutter clear (dark=$dark)", interior, sample(startLine + 30), 1.0)
    }

    @Test
    fun scrolledPastCardsFadeOverTheGutterOnlyInTheDarkTheme() = checkGutter(dark = true)

    @Test
    fun scrolledPastCardsFadeOverTheGutterOnlyInTheLightTheme() = checkGutter(dark = false)
}
