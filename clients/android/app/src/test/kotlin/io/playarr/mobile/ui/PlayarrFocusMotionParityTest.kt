package io.playarr.mobile.ui

import io.playarr.shared.designsystem.theme.FocusMotion
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Drives the shipped [FocusMotion] constants used by television focus
 * scaling. Values must stay aligned with Playarr Web design tokens and the
 * live TV surface grow-on-focus CSS.
 */
class PlayarrFocusMotionParityTest {
    @Test
    fun `tile focus scale matches live TV chrome grow`() {
        assertEquals(1.04f, FocusMotion.tileFocusScale, 0.0001f)
    }

    @Test
    fun `card focus scale matches poster-card focus treatment`() {
        assertEquals(1.045f, FocusMotion.cardFocusScale, 0.0001f)
    }

    @Test
    fun `transition duration matches design-token focusMotion`() {
        assertEquals(150, FocusMotion.transitionMs)
    }

    @Test
    fun `easing matches cubic-bezier 0_4 0 0_2 1`() {
        assertArrayEquals(
            floatArrayOf(0.4f, 0f, 0.2f, 1f),
            FocusMotion.easingControlPoints,
            0.0001f,
        )
    }

    @Test
    fun `rest scale is identity and focus grows`() {
        assertEquals(1.0f, FocusMotion.restScale, 0.0001f)
        assertTrue(FocusMotion.tileFocusScale > FocusMotion.restScale)
        assertTrue(FocusMotion.cardFocusScale > FocusMotion.restScale)
        assertTrue(FocusMotion.navFocusScale > FocusMotion.navSelectedScale)
        assertTrue(FocusMotion.navSelectedScale > FocusMotion.restScale)
    }

    @Test
    fun `selected chrome scale is between rest and full focus`() {
        assertTrue(FocusMotion.selectedScale > FocusMotion.restScale)
        assertTrue(FocusMotion.selectedScale < FocusMotion.cardFocusScale)
    }
}
