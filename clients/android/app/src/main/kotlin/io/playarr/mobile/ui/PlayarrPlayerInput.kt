package io.playarr.mobile.ui

import android.view.KeyEvent

internal enum class PlayarrPlayerSurfaceAction {
    TogglePlayback,
    SeekBackward,
    SeekForward,
    FocusBack,
    FocusSeek,
}

internal fun playarrPlayerSurfaceAction(keyCode: Int): PlayarrPlayerSurfaceAction? = when (keyCode) {
    KeyEvent.KEYCODE_DPAD_CENTER,
    KeyEvent.KEYCODE_ENTER,
    KeyEvent.KEYCODE_SPACE,
    -> PlayarrPlayerSurfaceAction.TogglePlayback
    KeyEvent.KEYCODE_DPAD_LEFT -> PlayarrPlayerSurfaceAction.SeekBackward
    KeyEvent.KEYCODE_DPAD_RIGHT -> PlayarrPlayerSurfaceAction.SeekForward
    KeyEvent.KEYCODE_DPAD_UP -> PlayarrPlayerSurfaceAction.FocusBack
    KeyEvent.KEYCODE_DPAD_DOWN -> PlayarrPlayerSurfaceAction.FocusSeek
    else -> null
}
