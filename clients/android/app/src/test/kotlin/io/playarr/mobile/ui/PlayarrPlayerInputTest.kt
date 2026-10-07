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
        // Arrows never seek from the surface: they only reveal (hidden) or restore focus.
        assertEquals(PlayarrPlayerSurfaceAction.Reveal, playarrPlayerSurfaceAction(KeyEvent.KEYCODE_DPAD_LEFT))
        assertEquals(PlayarrPlayerSurfaceAction.Reveal, playarrPlayerSurfaceAction(KeyEvent.KEYCODE_DPAD_RIGHT))
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
        assertEquals(58_000L + PLAYER_SEEK_STEP_MS, coalescedSeekTarget(58_000, null, PLAYER_SEEK_STEP_MS, 0))
        assertEquals(true, PLAYER_SEEK_COALESCE_MS in 400L..600L)
    }

    @Test
    fun `select on a hidden surface only reveals the controls`() {
        assertEquals(false, playarrSurfaceSelectTogglesPlayback(controlsWereVisible = false))
        assertEquals(true, playarrSurfaceSelectTogglesPlayback(controlsWereVisible = true))
    }

    @Test
    fun `dedicated media keys are not surface actions`() {
        assertNull(playarrPlayerSurfaceAction(KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE))
        assertNull(playarrPlayerSurfaceAction(KeyEvent.KEYCODE_MEDIA_PLAY))
        assertNull(playarrPlayerSurfaceAction(KeyEvent.KEYCODE_MEDIA_PAUSE))
        assertEquals(PlayarrMediaControlAction.TogglePlayback, playarrMediaControlAction(KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE))
    }

    @Test
    fun `quality bitrate detail never shows zero`() {
        assertEquals("24.3 Mbps", playarrQualityBitrateDetail(24_300_000L))
        assertEquals("8 Mbps", playarrQualityBitrateDetail(8_000_000L))
        assertEquals("0.8 Mbps", playarrQualityBitrateDetail(800_000L))
        assertNull(playarrQualityBitrateDetail(0L))
        assertNull(playarrQualityBitrateDetail(-5L))
        assertNull(playarrQualityBitrateDetail(null))
        assertNull(playarrQualityBitrateDetail(20_000L))
    }

    @Test
    fun `original label carries the bitrate only when known`() {
        assertEquals("Original · 24.3 Mbps", playarrQualityLabel("Original", 24_300_000L, true))
        assertEquals("Original", playarrQualityLabel("Original", null, true))
        assertEquals("Original", playarrQualityLabel("Original", 0L, true))
        assertEquals("FHD Medium", playarrQualityLabel("FHD Medium", 8_000_000L, false))
    }

    @Test
    fun `back closes the open panel first, then the controls, then exits`() {
        // Episodes / playlist panel
        assertEquals(PlayarrPlayerBackAction.ClosePlaylist, playarrPlayerBackAction(playlistOpen = true, menuOpen = false, controlsVisible = true))
        // Quality / audio / subtitles menu
        assertEquals(PlayarrPlayerBackAction.CloseMenu, playarrPlayerBackAction(playlistOpen = false, menuOpen = true, controlsVisible = true))
        // Controls overlay
        assertEquals(PlayarrPlayerBackAction.HideControls, playarrPlayerBackAction(playlistOpen = false, menuOpen = false, controlsVisible = true))
        // Controls hidden: one BACK exits.
        assertEquals(PlayarrPlayerBackAction.Exit, playarrPlayerBackAction(playlistOpen = false, menuOpen = false, controlsVisible = false))
    }

    @Test
    fun `back sequence takes one level per press`() {
        var playlist = true
        var menu = true
        var controls = true
        val presses = mutableListOf<PlayarrPlayerBackAction>()
        while (true) {
            val action = playarrPlayerBackAction(playlist, menu, controls)
            presses += action
            when (action) {
                PlayarrPlayerBackAction.ClosePlaylist -> playlist = false
                PlayarrPlayerBackAction.CloseMenu -> menu = false
                PlayarrPlayerBackAction.HideControls -> controls = false
                PlayarrPlayerBackAction.Exit -> break
            }
        }
        assertEquals(
            listOf(
                PlayarrPlayerBackAction.ClosePlaylist,
                PlayarrPlayerBackAction.CloseMenu,
                PlayarrPlayerBackAction.HideControls,
                PlayarrPlayerBackAction.Exit,
            ),
            presses,
        )
    }

    @Test
    fun `select on the scrubber is play-pause only and arrows are not select`() {
        assertEquals(true, playarrScrubberSelectKey(KeyEvent.KEYCODE_DPAD_CENTER))
        assertEquals(true, playarrScrubberSelectKey(KeyEvent.KEYCODE_ENTER))
        assertEquals(true, playarrScrubberSelectKey(KeyEvent.KEYCODE_NUMPAD_ENTER))
        assertEquals(false, playarrScrubberSelectKey(KeyEvent.KEYCODE_DPAD_LEFT))
        assertEquals(false, playarrScrubberSelectKey(KeyEvent.KEYCODE_DPAD_RIGHT))
    }

    @Test
    fun `controls animation matches web 240ms`() {
        assertEquals(240, PLAYER_CONTROLS_ANIMATION_MS)
    }

    @Test
    fun `scrubber step is ten seconds and accelerates while held`() {
        assertEquals(10_000L, PLAYER_SEEK_STEP_MS)
        assertEquals(10_000L, playarrSeekStepMs(0))
        // The hold delay: first repeats do nothing, then 2 s and 5 s per repeat event.
        assertEquals(0L, playarrSeekStepMs(1))
        assertEquals(0L, playarrSeekStepMs(9))
        assertEquals(2_000L, playarrSeekStepMs(10))
        assertEquals(2_000L, playarrSeekStepMs(29))
        assertEquals(5_000L, playarrSeekStepMs(30))
    }

    @Test
    fun `controls auto-hide after five seconds`() {
        assertEquals(5_000L, PLAYER_CONTROLS_TIMEOUT_MS)
    }

    @Test
    fun `focus returns to the last control while it exists else play pause`() {
        val tracker = PlayarrPlayerFocusTracker()
        assertEquals(PLAYER_FOCUS_PLAY, tracker.restoreKey())
        tracker.register("play"); tracker.register("quality"); tracker.register("seek")
        tracker.last = "seek"
        assertEquals("seek", tracker.restoreKey())
        tracker.last = "quality"
        assertEquals("quality", tracker.restoreKey())
        tracker.unregister("quality")
        assertEquals(PLAYER_FOCUS_PLAY, tracker.restoreKey())
    }
}
