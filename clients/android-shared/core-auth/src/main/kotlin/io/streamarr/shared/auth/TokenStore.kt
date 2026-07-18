package io.streamarr.shared.auth

import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import io.streamarr.shared.auth.model.TokenResponse
import java.util.UUID
import javax.inject.Inject
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
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
 * see `mobile-android`'s `di/AuthModule.kt` for where the
 * instance is created.
 */
class TokenStore @Inject constructor(
    private val dataStore: DataStore<Preferences>,
) {
    val accessToken: Flow<String?> = dataStore.data.map { it[ACCESS_TOKEN_KEY] }
    val refreshToken: Flow<String?> = dataStore.data.map { it[REFRESH_TOKEN_KEY] }

    suspend fun save(token: TokenResponse) {
        dataStore.edit { prefs ->
            prefs[ACCESS_TOKEN_KEY] = token.accessToken
            prefs[REFRESH_TOKEN_KEY] = token.refreshToken
            prefs[TOKEN_TYPE_KEY] = token.tokenType
        }
    }

    /**
     * Signs out: clears the stored access/refresh token pair. Deliberately
     * leaves [getOrCreateDeviceId]'s id untouched -- that id identifies
     * this *install*, not this *session*, and must survive sign-out so a
     * subsequent sign-in (device-flow pairing or [SessionManager] login)
     * resends the same one rather than minting a fresh device per sign-in.
     */
    suspend fun clear() {
        dataStore.edit { prefs ->
            prefs.remove(ACCESS_TOKEN_KEY)
            prefs.remove(REFRESH_TOKEN_KEY)
            prefs.remove(TOKEN_TYPE_KEY)
        }
    }

    /**
     * The client-generated, stable-per-install device id `LoginRequest`
     * expects -- see `SessionManager.ensureAccessToken`.
     * Generated once (a random [UUID]) and persisted through this same
     * `DataStore<Preferences>` the first time anything asks for it, rather
     * than a second, parallel store; every subsequent login/refresh from
     * this install resends the same id, so `Policy::device_allow`/
     * `max_concurrent_sessions` reason about one device, not a fresh one
     * per call.
     */
    suspend fun getOrCreateDeviceId(): String {
        val existing = dataStore.data.map { it[DEVICE_ID_KEY] }.first()
        if (existing != null) return existing
        val generated = UUID.randomUUID().toString()
        dataStore.edit { it[DEVICE_ID_KEY] = generated }
        return generated
    }

    private companion object {
        val ACCESS_TOKEN_KEY = stringPreferencesKey("streamarr_access_token")
        val REFRESH_TOKEN_KEY = stringPreferencesKey("streamarr_refresh_token")
        val TOKEN_TYPE_KEY = stringPreferencesKey("streamarr_token_type")
        val DEVICE_ID_KEY = stringPreferencesKey("streamarr_device_id")
    }
}
