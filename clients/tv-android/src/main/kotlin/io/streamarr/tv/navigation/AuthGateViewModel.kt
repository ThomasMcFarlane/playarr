package io.streamarr.tv.navigation

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import io.streamarr.shared.auth.TokenStore
import javax.inject.Inject
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn

/**
 * Decides whether [StreamarrTvNavHost] should start on the RFC 8628
 * pairing gate or straight into the main app, and whether a later sign-out
 * should route back to pairing. `null` means "not yet known" (DataStore's
 * first emission hasn't landed) -- the NavHost defers composing at all
 * until this resolves, so `startDestination` is never set to the wrong
 * value and then corrected.
 */
@HiltViewModel
class AuthGateViewModel @Inject constructor(
    tokenStore: TokenStore,
) : ViewModel() {
    val isSignedIn: StateFlow<Boolean?> = tokenStore.accessToken
        .map { it != null }
        .stateIn(viewModelScope, SharingStarted.Eagerly, null)
}
