package io.streamarr.mobile.ui

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
