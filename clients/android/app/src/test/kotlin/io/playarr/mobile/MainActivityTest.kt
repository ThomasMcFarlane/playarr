package io.playarr.mobile

import android.content.res.Configuration
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class MainActivityTest {
    @Test
    fun `recognises television UI mode`() {
        assertTrue(
            isTelevision(
                uiModeType = Configuration.UI_MODE_TYPE_TELEVISION,
                hasLeanbackFeature = false,
                hasTelevisionFeature = false,
            ),
        )
    }

    @Test
    fun `recognises Leanback devices even when vendor UI mode is wrong`() {
        assertTrue(
            isTelevision(
                uiModeType = Configuration.UI_MODE_TYPE_NORMAL,
                hasLeanbackFeature = true,
                hasTelevisionFeature = false,
            ),
        )
    }

    @Test
    fun `recognises television hardware even when vendor UI mode is wrong`() {
        assertTrue(
            isTelevision(
                uiModeType = Configuration.UI_MODE_TYPE_NORMAL,
                hasLeanbackFeature = false,
                hasTelevisionFeature = true,
            ),
        )
    }

    @Test
    fun `does not classify a normal mobile device as a television`() {
        assertFalse(
            isTelevision(
                uiModeType = Configuration.UI_MODE_TYPE_NORMAL,
                hasLeanbackFeature = false,
                hasTelevisionFeature = false,
            ),
        )
    }
}
