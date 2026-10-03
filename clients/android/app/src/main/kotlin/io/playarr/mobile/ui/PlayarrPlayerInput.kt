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

/** D-pad LEFT/RIGHT step on the player surface. */
internal const val PLAYER_SEEK_STEP_MS = 5_000L

/** Idle time after the last D-pad press before one seek is issued. */
internal const val PLAYER_SEEK_COALESCE_MS = 500L

/**
 * Target after another D-pad step: accumulates from the pending (not yet
 * issued) target, else from the current position, so N rapid presses become a
 * single seek of N steps instead of N fetch restarts.
 */
internal fun coalescedSeekTarget(positionMs: Long, pendingMs: Long?, deltaMs: Long, durationMs: Long): Long {
    val target = (pendingMs ?: positionMs) + deltaMs
    return if (durationMs > 0L) target.coerceIn(0L, durationMs) else target.coerceAtLeast(0L)
}
