package io.playarr.mobile.ui

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.os.Handler
import android.os.Looper
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.State
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalContext

@Composable
internal fun rememberPlayarrOnlineStatus(): State<Boolean> {
    val context = LocalContext.current
    val connectivityManager = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
    val online = remember(connectivityManager) {
        mutableStateOf(connectivityManager.activeNetwork != null)
    }
    DisposableEffect(connectivityManager) {
        val callback = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) {
                online.value = true
            }

            override fun onLost(network: Network) {
                online.value = connectivityManager.activeNetwork != null
            }

            override fun onUnavailable() {
                online.value = false
            }
        }
        connectivityManager.registerDefaultNetworkCallback(callback, Handler(Looper.getMainLooper()))
        online.value = connectivityManager.activeNetwork != null
        onDispose {
            runCatching { connectivityManager.unregisterNetworkCallback(callback) }
        }
    }
    return online
}

internal fun shouldShowPlayarrOfflineState(isOnline: Boolean, currentRoute: String): Boolean =
    !isOnline &&
        currentRoute != "downloads" &&
        currentRoute != "profiles" &&
        !currentRoute.startsWith("experience-player")

internal fun shouldHandlePlayarrMiniPlayerBack(isPlayer: Boolean, hasPlayback: Boolean): Boolean =
    !isPlayer && hasPlayback

/**
 * The in-app mini player only appears once playback is actually ready, never over loading or failed
 * starts. Video uses it as the fallback when system Picture-in-Picture is unavailable.
 */
internal fun shouldShowPlayarrMiniPlayer(isPlayer: Boolean, hasPlayback: Boolean, playerReady: Boolean): Boolean =
    !isPlayer && hasPlayback && playerReady

/** Video items get a live video surface in the mini player; music keeps its artwork. */
internal fun playarrMiniPlayerShowsVideo(isMusic: Boolean): Boolean = !isMusic

/**
 * Minimise target for the player screen: music always uses the in-app mini player, video uses
 * system Picture-in-Picture when the device offers it and the mini player otherwise.
 */
internal enum class PlayarrMinimiseTarget { MiniPlayer, PictureInPicture }

internal fun playarrMinimiseTarget(isMusic: Boolean, pipSupported: Boolean): PlayarrMinimiseTarget =
    if (!isMusic && pipSupported) PlayarrMinimiseTarget.PictureInPicture else PlayarrMinimiseTarget.MiniPlayer

/** A failed start that the viewer has left (minimised or navigated away from) is discarded. */
internal fun shouldClearPlayarrFailedPlayback(playerFailed: Boolean, isPlayer: Boolean, hasPlayback: Boolean): Boolean =
    playerFailed && !isPlayer && hasPlayback
