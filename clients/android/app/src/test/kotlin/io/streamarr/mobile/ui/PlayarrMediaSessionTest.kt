package io.streamarr.mobile.ui

import android.view.KeyEvent
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class PlayarrMediaSessionTest {
    @Test
    fun `hardware media keys match Playarr Web global controls`() {
        assertEquals(PlayarrMediaControlAction.Play, playarrMediaControlAction(KeyEvent.KEYCODE_MEDIA_PLAY))
        assertEquals(PlayarrMediaControlAction.Pause, playarrMediaControlAction(KeyEvent.KEYCODE_MEDIA_PAUSE))
        assertEquals(PlayarrMediaControlAction.TogglePlayback, playarrMediaControlAction(KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE))
        assertEquals(PlayarrMediaControlAction.Stop, playarrMediaControlAction(KeyEvent.KEYCODE_MEDIA_STOP))
        assertEquals(PlayarrMediaControlAction.SeekBackward, playarrMediaControlAction(KeyEvent.KEYCODE_MEDIA_REWIND))
        assertEquals(PlayarrMediaControlAction.SeekForward, playarrMediaControlAction(KeyEvent.KEYCODE_MEDIA_FAST_FORWARD))
        assertEquals(PlayarrMediaControlAction.Previous, playarrMediaControlAction(KeyEvent.KEYCODE_MEDIA_PREVIOUS))
        assertEquals(PlayarrMediaControlAction.Next, playarrMediaControlAction(KeyEvent.KEYCODE_MEDIA_NEXT))
        assertNull(playarrMediaControlAction(KeyEvent.KEYCODE_BACK))
    }
}
