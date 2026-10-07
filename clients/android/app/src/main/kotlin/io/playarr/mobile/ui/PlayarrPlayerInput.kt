package io.playarr.mobile.ui

import android.view.KeyEvent

internal enum class PlayarrPlayerSurfaceAction {
    TogglePlayback,

    /** LEFT/RIGHT on the surface: never seeks. Reveals hidden controls, else returns focus to the last control. */
    Reveal,
    FocusBack,
    FocusSeek,
}

internal fun playarrPlayerSurfaceAction(keyCode: Int): PlayarrPlayerSurfaceAction? = when (keyCode) {
    KeyEvent.KEYCODE_DPAD_CENTER,
    KeyEvent.KEYCODE_ENTER,
    KeyEvent.KEYCODE_SPACE,
    -> PlayarrPlayerSurfaceAction.TogglePlayback
    KeyEvent.KEYCODE_DPAD_LEFT,
    KeyEvent.KEYCODE_DPAD_RIGHT,
    -> PlayarrPlayerSurfaceAction.Reveal
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

/** Scrubber LEFT/RIGHT step (web `SEEK_STEP`): 10 s per press. */
internal const val PLAYER_SEEK_STEP_MS = 10_000L

/** Controls hide after this long without input while playing. */
internal const val PLAYER_CONTROLS_TIMEOUT_MS = 5_000L

/**
 * Seek step for one scrubber key event. A fresh press (repeatCount 0) steps 10 s; the first presses of a held key
 * are ignored (hold delay), then the seek accelerates: 2 s per repeat event, and 5 s per event once held long.
 */
internal fun playarrSeekStepMs(repeatCount: Int): Long = when {
    repeatCount <= 0 -> PLAYER_SEEK_STEP_MS
    repeatCount < 10 -> 0L
    repeatCount < 30 -> 2_000L
    else -> 5_000L
}

/** Where focus goes when the controls reappear: the last focused control while it still exists, else play/pause. */
internal const val PLAYER_FOCUS_PLAY = "play"

internal class PlayarrPlayerFocusTracker {
    var last: String = PLAYER_FOCUS_PLAY
    private val keys = LinkedHashSet<String>()
    fun register(key: String) { keys.add(key) }
    fun unregister(key: String) { keys.remove(key) }
    fun restoreKey(): String = if (last in keys) last else PLAYER_FOCUS_PLAY
}

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

/** What one BACK press does in the player: panels close first (one level per press), then the controls, then exit. */
internal enum class PlayarrPlayerBackAction { ClosePlaylist, CloseMenu, HideControls, Exit }

internal fun playarrPlayerBackAction(playlistOpen: Boolean, menuOpen: Boolean, controlsVisible: Boolean): PlayarrPlayerBackAction = when {
    playlistOpen -> PlayarrPlayerBackAction.ClosePlaylist
    menuOpen -> PlayarrPlayerBackAction.CloseMenu
    controlsVisible -> PlayarrPlayerBackAction.HideControls
    else -> PlayarrPlayerBackAction.Exit
}

/** SELECT/OK/Enter on the focused scrubber only toggles play/pause: no scrub commit, nothing else. */
internal fun playarrScrubberSelectKey(keyCode: Int): Boolean = when (keyCode) {
    KeyEvent.KEYCODE_DPAD_CENTER,
    KeyEvent.KEYCODE_ENTER,
    KeyEvent.KEYCODE_NUMPAD_ENTER,
    -> true
    else -> false
}

/** Scrim / controls timing shared with web (`.player-scrim` transition: 240ms ease). */
internal const val PLAYER_CONTROLS_ANIMATION_MS = 240
