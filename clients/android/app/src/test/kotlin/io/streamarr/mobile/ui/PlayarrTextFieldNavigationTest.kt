package io.streamarr.mobile.ui

import androidx.compose.ui.focus.FocusDirection
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEventType
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class PlayarrTextFieldNavigationTest {

    @Test
    fun `single-line fields release vertical key downs`() {
        assertEquals(FocusDirection.Up, playarrSingleLineArrowDirection(Key.DirectionUp, KeyEventType.KeyDown))
        assertEquals(FocusDirection.Down, playarrSingleLineArrowDirection(Key.DirectionDown, KeyEventType.KeyDown))
    }

    @Test
    fun `single-line fields preserve caret and key-up behavior`() {
        assertNull(playarrSingleLineArrowDirection(Key.DirectionLeft, KeyEventType.KeyDown))
        assertNull(playarrSingleLineArrowDirection(Key.DirectionRight, KeyEventType.KeyDown))
        assertNull(playarrSingleLineArrowDirection(Key.DirectionDown, KeyEventType.KeyUp))
    }
}
