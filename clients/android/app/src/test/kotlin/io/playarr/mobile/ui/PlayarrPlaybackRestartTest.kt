package io.playarr.mobile.ui

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PlayarrPlaybackRestartTest {
    private val request = PlayarrPlayRequest("file-1", 12_000L, null)

    private fun restart(
        active: PlayarrPlayRequest? = request,
        requested: PlayarrPlayRequest = request,
        hasEnded: Boolean = false,
        hasFailed: Boolean = false,
        force: Boolean = false,
    ) = shouldRestartPlayarrPlayback(active, requested, hasEnded, hasFailed, force)

    @Test
    fun redeliveredIdenticalRequestKeepsTheBuffer() {
        assertFalse(restart())
    }

    @Test
    fun firstOrDifferentRequestPrepares() {
        assertTrue(restart(active = null))
        assertTrue(restart(requested = request.copy(mediaFileId = "file-2")))
        assertTrue(restart(requested = request.copy(requestedStartPositionMs = 0L)))
    }

    @Test
    fun endedFailedAndForcedRestart() {
        assertTrue(restart(hasEnded = true))
        assertTrue(restart(hasFailed = true))
        assertTrue(restart(force = true))
    }

    @Test
    fun replayAfterEndRenegotiatesEvenForTheIdenticalRequest() {
        // End-of-playback spec section 5: the ended session is already closed
        // as completed, so Replay must start a fresh playback session.
        val replay = request.copy(requestedStartPositionMs = 0L)
        assertTrue(restart(active = replay, requested = replay, hasEnded = true, force = true))
    }
}
