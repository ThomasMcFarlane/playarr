package io.playarr.mobile.ui

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.assertIsFocused
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performKeyInput
import androidx.compose.ui.test.pressKey
import io.playarr.shared.player.PlaybackState
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

/** The scrubber keeps focus through repeated seeks and source switches, and SELECT only toggles playback. */
@OptIn(ExperimentalTestApi::class)
class PlayarrScrubberFocusUiTest {
    @get:Rule
    val compose = createComposeRule()

    @Test
    fun scrubberKeepsFocusAcrossRepeatedSeeksAndSwitches() {
        val seek = FocusRequester()
        var toggles = 0
        val steps = mutableListOf<Pair<Int, Int>>()
        var switching by mutableStateOf(false)
        var position by mutableStateOf(60_000L)
        compose.setContent {
            PlayarrTelevisionControlBar(
                playbackState = PlaybackState(playWhenReady = true),
                controls = PlayarrPlaybackControls(switching = switching),
                displayedPositionMs = position,
                durationMs = 600_000L,
                bufferedProgress = 0.3f,
                seekDescription = "scrubber",
                seekFocusRequester = seek,
                canPrevious = false,
                canNext = false,
                queue = PlayarrPlaybackQueue(),
                playlistOpen = false,
                seekTargetMs = 90_000L,
                onSeekStep = { direction, repeat -> steps += direction to repeat },
                onScrub = { position = it },
                onScrubFinished = {},
                onTogglePlayback = { toggles++ },
                onPrevious = {},
                onNext = {},
                onMenu = {},
                onTogglePlaylist = {},
                trailing = {},
            )
        }
        compose.runOnUiThread { seek.requestFocus() }
        val scrubber = compose.onNodeWithContentDescription("scrubber")
        scrubber.assertIsFocused()
        repeat(8) {
            scrubber.performKeyInput { pressKey(Key.DirectionRight) }
            // Each seek flips the control to its switching state and back.
            switching = true
            compose.waitForIdle()
            switching = false
            compose.waitForIdle()
            scrubber.assertIsFocused()
        }
        // Each press is one 10 s scrubber step (the Slider's own 1% step is bypassed): the position is untouched here.
        assertEquals(List(8) { 1 to 0 }, steps)
        assertEquals(60_000L, position)
        compose.onNodeWithText("1:30").assertExists()
        // SELECT toggles playback only and leaves focus (and position) alone.
        val before = position
        scrubber.performKeyInput { pressKey(Key.DirectionCenter) }
        assertEquals(1, toggles)
        assertEquals(before, position)
        scrubber.assertIsFocused()
    }
}
