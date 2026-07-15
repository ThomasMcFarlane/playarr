package io.streamarr.shared.auth

import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import io.streamarr.shared.auth.model.TokenResponse
import javax.inject.Inject
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map

/**
 * Persists the current access/refresh token pair across process death.
 * Access tokens are short-lived (15 min default, per `auth-modes.md`) so
 * holding them in memory would be fine on its own, but the refresh token
 * (30-day default lifetime) must survive the app being killed or a TV
 * pairing would need to be redone every cold start.
 *
 * Takes a [DataStore] rather than a [android.content.Context] so the app
 * modules control exactly which DataStore instance (and file name) this
 * writes to, consistent with this module staying DI-framework-agnostic --
 * see `mobile-android`/`tv-android`'s `di/AuthModule.kt` for where the
 * instance is created.
 */
class TokenStore @Inject constructor(
    private val dataStore: DataStore<Preferences>,
) {
    val accessToken: Flow<String?> = dataStore.data.map { it[ACCESS_TOKEN_KEY] }
    val refreshToken: Flow<String?> = dataStore.data.map { it[REFRESH_TOKEN_KEY] }

    /** The current access token's `sub` claim (the signed-in user's id) -- see [JwtClaims]. `null` when signed out or the token doesn't decode. */
    val userId: Flow<String?> = accessToken.map { token -> token?.let(JwtClaims::subject) }

    suspend fun save(token: TokenResponse) {
        dataStore.edit { prefs ->
            prefs[ACCESS_TOKEN_KEY] = token.accessToken
            prefs[REFRESH_TOKEN_KEY] = token.refreshToken
            prefs[TOKEN_TYPE_KEY] = token.tokenType
        }
    }

    suspend fun clear() {
        dataStore.edit { it.clear() }
    }

    private companion object {
        val ACCESS_TOKEN_KEY = stringPreferencesKey("streamarr_access_token")
        val REFRESH_TOKEN_KEY = stringPreferencesKey("streamarr_refresh_token")
        val TOKEN_TYPE_KEY = stringPreferencesKey("streamarr_token_type")
    }
}
