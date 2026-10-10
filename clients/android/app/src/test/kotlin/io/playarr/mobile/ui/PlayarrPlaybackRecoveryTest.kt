package io.playarr.mobile.ui

import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class PlayarrPlaybackRecoveryTest {
    private fun source(name: String) = File("src/main/kotlin/io/playarr/mobile/ui/$name").readText()

    @Test
    fun `controls auto-hide after five seconds`() {
        assertEquals(5_000L, PLAYER_CONTROLS_TIMEOUT_MS)
    }

    @Test
    fun `automatic retries back off and then give up`() {
        assertEquals(1_500L, playarrAutoRetryDelayMs(0))
        assertEquals(3_000L, playarrAutoRetryDelayMs(1))
        assertEquals(6_000L, playarrAutoRetryDelayMs(2))
        assertNull(playarrAutoRetryDelayMs(3))
    }

    @Test
    fun `a retry after the decoder fallback stays on the converted stream`() {
        val original = PlayarrPlaybackLaunchSettings("original", null, false, 2, "sub-1")
        assertEquals(original, playarrAutoRetryLaunchSettings(original, decoderFallbackAttempted = false))
        assertNull(playarrAutoRetryLaunchSettings(null, decoderFallbackAttempted = false))

        val retry = playarrAutoRetryLaunchSettings(original, decoderFallbackAttempted = true)!!
        assertTrue(retry.forceTranscode)
        assertEquals(DECODE_FALLBACK_PROFILE, retry.profile)
        assertEquals(DECODE_FALLBACK_PROFILE, retry.qualityId)
        assertEquals(2, retry.audioStreamIndex)
        assertEquals("sub-1", retry.subtitleTrackId)
        assertTrue(playarrAutoRetryLaunchSettings(null, decoderFallbackAttempted = true)!!.forceTranscode)
        assertTrue(
            source("PlayarrExperience.kt")
                .contains("playarrAutoRetryLaunchSettings(activeRequest?.launchSettings, decoderFallbackAttempted)"),
        )
    }

    @Test
    fun `double tap seeks ten seconds by half of the screen`() {
        assertEquals(-10_000L, playarrDoubleTapSeekDeltaMs(100f, 1000f))
        assertEquals(10_000L, playarrDoubleTapSeekDeltaMs(900f, 1000f))
    }

    @Test
    fun `a stalled start is retried then surfaces a human error, never raw text`() {
        val experience = source("PlayarrExperience.kt")
        assertTrue(experience.contains("armStartStallWatchdog()"))
        assertTrue(experience.contains("scheduleAutoRetry("))
        assertTrue(experience.contains("PlayarrString.PlayerStartStalled"))
        assertFalse(experience.contains("""mapOf(
                                        "message" to currentError.message"""))
        assertTrue(PLAYER_START_STALL_TIMEOUT_MS in 10_000L..60_000L)
    }

    @Test
    fun `the converted stream fallback is announced and a failed player has the X close`() {
        val experience = source("PlayarrExperience.kt")
        assertTrue(experience.contains("_notice.value = PlayarrString.PlayerStreamConverted"))
        val failedBranch = experience.substringAfter("Errors show inside the player with the same X close").substringBefore("PlayarrEndOfPlaybackHost(")
        assertTrue(failedBranch.contains("PlayarrPlayerLoadingClose("))
        assertFalse(experience.contains("Icons.AutoMirrored.Outlined.ArrowBack,\n                    contentDescription = null,\n                    tint = Color.White)"))
    }

    @Test
    fun `leaving the app pauses and saves, and returning shows the controls`() {
        val experience = source("PlayarrExperience.kt")
        assertTrue(experience.contains("Lifecycle.Event.ON_STOP"))
        assertTrue(experience.contains("pauseForBackground()"))
        assertTrue(source("PlayarrPlayerChrome.kt").contains("Lifecycle.Event.ON_RESUME) { showControls() }"))
    }

    @Test
    fun `phone surface handles tap and double tap, television keeps clickable`() {
        val chrome = source("PlayarrPlayerChrome.kt")
        assertTrue(chrome.contains("detectTapGestures("))
        assertTrue(chrome.contains("onDoubleTap = { offset ->"))
    }
}
