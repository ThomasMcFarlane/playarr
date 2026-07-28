package io.playarr.mobile.ui

import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusDirection
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.platform.LocalFocusManager

/**
 * Single-line fields use Left/Right for caret movement, but Up/Down must
 * return to spatial navigation once an on-screen keyboard is dismissed.
 */
internal fun playarrSingleLineArrowDirection(key: Key, type: KeyEventType): FocusDirection? {
    if (type != KeyEventType.KeyDown) return null
    return when (key) {
        Key.DirectionUp -> FocusDirection.Up
        Key.DirectionDown -> FocusDirection.Down
        else -> null
    }
}

@Composable
internal fun Modifier.playarrSingleLineArrowNavigation(): Modifier {
    val focusManager = LocalFocusManager.current
    return onPreviewKeyEvent { event ->
        playarrSingleLineArrowDirection(event.key, event.type)?.let(focusManager::moveFocus) ?: false
    }
}
