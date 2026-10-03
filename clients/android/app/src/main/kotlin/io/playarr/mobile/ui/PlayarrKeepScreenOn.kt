package io.playarr.mobile.ui

import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import android.view.WindowManager
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.ui.platform.LocalContext

/**
 * Video must hold the screen awake: Google TV's ambient screensaver and the
 * phone display timeout key off user input, not off an active MediaSession,
 * and previously kicked in mid-playback. Held while playback is intended to
 * continue (buffering counts, a user pause does not), never for audio-only
 * or casting, where the local screen shows no video.
 */
internal fun shouldKeepScreenOn(
    playWhenReady: Boolean,
    hasEnded: Boolean,
    hasError: Boolean,
    showsLocalVideo: Boolean,
    endCardHeld: Boolean = false,
): Boolean = showsLocalVideo && !hasError && ((playWhenReady && !hasEnded) || endCardHeld)

/** Sets or clears `FLAG_KEEP_SCREEN_ON` on the host window; always cleared on dispose. */
@Composable
internal fun PlayarrKeepScreenOn(keep: Boolean) {
    val window = LocalContext.current.findActivity()?.window ?: return
    DisposableEffect(window, keep) {
        if (keep) window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        else window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        onDispose { window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON) }
    }
}

private fun Context.findActivity(): Activity? {
    var c: Context? = this
    while (c is ContextWrapper) {
        if (c is Activity) return c
        c = c.baseContext
    }
    return null
}
