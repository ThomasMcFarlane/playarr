package io.playarr.mobile.ui

import android.view.KeyEvent
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class PlayarrPlayerInputTest {
    @Test
    fun `player surface remote keys match Playarr Web`() {
        assertEquals(PlayarrPlayerSurfaceAction.TogglePlayback, playarrPlayerSurfaceAction(KeyEvent.KEYCODE_DPAD_CENTER))
        assertEquals(PlayarrPlayerSurfaceAction.TogglePlayback, playarrPlayerSurfaceAction(KeyEvent.KEYCODE_ENTER))
        assertEquals(PlayarrPlayerSurfaceAction.TogglePlayback, playarrPlayerSurfaceAction(KeyEvent.KEYCODE_SPACE))
        assertEquals(PlayarrPlayerSurfaceAction.SeekBackward, playarrPlayerSurfaceAction(KeyEvent.KEYCODE_DPAD_LEFT))
        assertEquals(PlayarrPlayerSurfaceAction.SeekForward, playarrPlayerSurfaceAction(KeyEvent.KEYCODE_DPAD_RIGHT))
        assertEquals(PlayarrPlayerSurfaceAction.FocusBack, playarrPlayerSurfaceAction(KeyEvent.KEYCODE_DPAD_UP))
        assertEquals(PlayarrPlayerSurfaceAction.FocusSeek, playarrPlayerSurfaceAction(KeyEvent.KEYCODE_DPAD_DOWN))
        assertNull(playarrPlayerSurfaceAction(KeyEvent.KEYCODE_BACK))
    }

    @Test
    fun `rapid D-pad presses accumulate into one target`() {
        var pending: Long? = null
        repeat(60) { pending = coalescedSeekTarget(100_000, pending, PLAYER_SEEK_STEP_MS, 7_200_000) }
        assertEquals(100_000 + 60 * PLAYER_SEEK_STEP_MS, pending)
        // Direction changes net out against the pending target, not the live position.
        pending = coalescedSeekTarget(100_000, pending, -PLAYER_SEEK_STEP_MS, 7_200_000)
        assertEquals(100_000 + 59 * PLAYER_SEEK_STEP_MS, pending)
    }

    @Test
    fun `coalesced target is clamped to the media bounds`() {
        assertEquals(0L, coalescedSeekTarget(2_000, null, -PLAYER_SEEK_STEP_MS, 60_000))
        assertEquals(60_000L, coalescedSeekTarget(58_000, null, PLAYER_SEEK_STEP_MS, 60_000))
        assertEquals(63_000L, coalescedSeekTarget(58_000, null, PLAYER_SEEK_STEP_MS, 0))
        assertEquals(true, PLAYER_SEEK_COALESCE_MS in 400L..600L)
    }
}
