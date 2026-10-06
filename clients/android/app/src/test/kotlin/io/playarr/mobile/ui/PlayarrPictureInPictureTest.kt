package io.playarr.mobile.ui

import androidx.lifecycle.Lifecycle
import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class PlayarrPictureInPictureTest {
    @Test
    fun `aspect ratio follows the video and is clamped`() {
        assertEquals(PlayarrPipRatio(16, 9), playarrPipAspectRatio(0, 0))
        assertEquals(1777, playarrPipAspectRatio(1920, 1080).numerator)
        assertEquals(1000, playarrPipAspectRatio(1920, 1080).denominator)
        assertEquals(PlayarrPipRatio(239, 100), playarrPipAspectRatio(4000, 1000))
        assertEquals(PlayarrPipRatio(100, 239), playarrPipAspectRatio(1000, 4000))
        // Anamorphic pixels widen the displayed ratio.
        assertTrue(playarrPipAspectRatio(720, 576, 1.4567f).numerator > 1500)
    }

    @Test
    fun `pip is gated on the device feature and local video playback`() {
        assertFalse(playarrPipSupported(false))
        assertTrue(playarrPipSupported(true))
        assertTrue(playarrPipEligible(true, localVideoShown = true, ready = true, hasEnded = false, hasError = false))
        assertFalse(playarrPipEligible(false, true, true, false, false))
        assertFalse(playarrPipEligible(true, localVideoShown = false, ready = true, hasEnded = false, hasError = false))
        assertFalse(playarrPipEligible(true, true, ready = false, hasEnded = false, hasError = false))
        assertFalse(playarrPipEligible(true, true, true, hasEnded = true, hasError = false))
        assertFalse(playarrPipEligible(true, true, true, false, hasError = true))
    }

    @Test
    fun `leaving the app enters pip only while playing`() {
        assertTrue(playarrShouldEnterPipOnLeave(eligible = true, playing = true))
        assertFalse(playarrShouldEnterPipOnLeave(eligible = true, playing = false))
        assertFalse(playarrShouldEnterPipOnLeave(eligible = false, playing = true))
    }

    @Test
    fun `closing the pip window is told apart from expanding it`() {
        assertTrue(playarrPipWindowDismissed(leftPip = true, lifecycleState = Lifecycle.State.CREATED))
        assertFalse(playarrPipWindowDismissed(leftPip = true, lifecycleState = Lifecycle.State.STARTED))
        assertFalse(playarrPipWindowDismissed(leftPip = true, lifecycleState = Lifecycle.State.RESUMED))
        assertFalse(playarrPipWindowDismissed(leftPip = false, lifecycleState = Lifecycle.State.CREATED))
    }

    @Test
    fun `remote action ids round trip`() {
        PlayarrPipControl.entries.forEach { assertEquals(it, PlayarrPipControl.fromWire(it.wire)) }
        assertNull(PlayarrPipControl.fromWire("nope"))
        assertNull(PlayarrPipControl.fromWire(null))
    }

    @Test
    fun `enter is refused unless eligible and an activity is attached`() {
        PlayarrPictureInPicture.clear()
        PlayarrPictureInPicture.requestEnter = { true }
        assertFalse(PlayarrPictureInPicture.enter())
        PlayarrPictureInPicture.publish(PlayarrPipState(eligible = true, playing = true))
        assertTrue(PlayarrPictureInPicture.enter())
        PlayarrPictureInPicture.requestEnter = null
        assertFalse(PlayarrPictureInPicture.enter())
        PlayarrPictureInPicture.clear()
    }

    @Test
    fun `manifest declares picture in picture on the activity`() {
        val file = File("src/main/AndroidManifest.xml").takeIf { it.isFile } ?: File("app/src/main/AndroidManifest.xml")
        val text = file.readText()
        assertTrue(text.contains("android:supportsPictureInPicture=\"true\""))
        listOf("screenSize", "smallestScreenSize", "screenLayout", "orientation").forEach {
            assertTrue("configChanges must include $it", text.contains(it))
        }
    }
}
