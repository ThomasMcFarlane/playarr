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
}
