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

/**
 * A tap (phone) or D-pad centre/OK/Enter/Space press (TV) on the player surface
 * only reveals hidden controls; it toggles playback only when the controls were
 * already visible. Dedicated media keys (MEDIA_PLAY_PAUSE and friends) are not
 * surface actions: the media session toggles playback for them regardless.
 */
internal fun playarrSurfaceSelectTogglesPlayback(controlsWereVisible: Boolean): Boolean = controlsWereVisible

/** Detail text for a quality row: one-decimal Mbps, or null when unknown or not positive. */
internal fun playarrQualityBitrateDetail(bps: Long?): String? {
    if (bps == null || bps <= 0L) return null
    val tenths = (bps + 50_000L) / 100_000L
    if (tenths <= 0L) return null
    val text = if (tenths % 10L == 0L) "${tenths / 10L}" else "${tenths / 10L}.${tenths % 10L}"
    return "$text Mbps"
}

/** Label for a quality row: "Original · 24.3 Mbps" or plain "Original" when no bitrate is known. */
internal fun playarrQualityLabel(label: String, bps: Long?, includeBitrate: Boolean): String =
    if (includeBitrate) playarrQualityBitrateDetail(bps)?.let { "$label · $it" } ?: label else label

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
