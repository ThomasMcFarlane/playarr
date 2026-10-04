package io.playarr.mobile

import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.ProcessLifecycleOwner
import io.playarr.shared.auth.TokenStore
import io.playarr.shared.data.events.LiveEventsManager
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.launch

/** Identifies the server and account the stream belongs to; `null` when signed out. */
internal fun liveEventsSessionKey(accessToken: String?, serverUrl: String?, userId: String?): String? =
    if (accessToken.isNullOrBlank()) null else "${serverUrl.orEmpty()}|${userId.orEmpty()}"

/**
 * Subscribes [manager] only while the whole app is foregrounded and signed
 * in: the process lifecycle starts/stops it, and the token store's session
 * (server + account) selects or drops it.
 */
internal fun bindLiveEvents(scope: CoroutineScope, manager: LiveEventsManager, tokenStore: TokenStore) {
    ProcessLifecycleOwner.get().lifecycle.addObserver(
        object : DefaultLifecycleObserver {
            override fun onStart(owner: LifecycleOwner) = manager.setForeground(true)
            override fun onStop(owner: LifecycleOwner) = manager.setForeground(false)
        },
    )
    scope.launch {
        combine(tokenStore.accessToken, tokenStore.currentServerUrl, tokenStore.currentUserId, ::liveEventsSessionKey)
            .distinctUntilChanged()
            .collect(manager::setSession)
    }
}
