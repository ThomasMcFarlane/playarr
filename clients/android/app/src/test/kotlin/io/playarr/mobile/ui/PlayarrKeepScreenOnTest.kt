package io.playarr.mobile.ui

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PlayarrKeepScreenOnTest {
    @Test
    fun heldWhilePlayingOrBufferingVideo() {
        assertTrue(shouldKeepScreenOn(playWhenReady = true, hasEnded = false, hasError = false, showsLocalVideo = true))
    }

    @Test
    fun releasedWhenPausedEndedFailedOrNotShowingVideo() {
        assertFalse(shouldKeepScreenOn(false, hasEnded = false, hasError = false, showsLocalVideo = true))
        assertFalse(shouldKeepScreenOn(true, hasEnded = true, hasError = false, showsLocalVideo = true))
        assertFalse(shouldKeepScreenOn(true, hasEnded = false, hasError = true, showsLocalVideo = true))
        assertFalse(shouldKeepScreenOn(true, hasEnded = false, hasError = false, showsLocalVideo = false))
    }
}
