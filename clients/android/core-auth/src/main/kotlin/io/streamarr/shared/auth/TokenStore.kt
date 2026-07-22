package io.streamarr.shared.auth

import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.MutablePreferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import io.streamarr.shared.auth.model.TokenResponse
import java.util.UUID
import javax.inject.Inject
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

data class SavedProfile(
    val serverUrl: String,
    val userId: String,
    val name: String?,
    val avatar: SavedProfileAvatar? = null,
)

data class SavedProfileAvatar(val kind: String, val value: String)

@Serializable
private data class StoredProfileSession(
    val serverUrl: String,
    val userId: String,
    val name: String? = null,
    val accessToken: String,
    val refreshToken: String,
    val tokenType: String,
    val avatarKind: String? = null,
    val avatarValue: String? = null,
)

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
 * see the app module's `di/AuthModule.kt` for where the
 * instance is created.
 */
class TokenStore @Inject constructor(
    private val dataStore: DataStore<Preferences>,
) {
    val accessToken: Flow<String?> = dataStore.data.map { it[ACCESS_TOKEN_KEY] }
    val refreshToken: Flow<String?> = dataStore.data.map { it[REFRESH_TOKEN_KEY] }
    val currentUserId: Flow<String?> = dataStore.data.map { it[USER_ID_KEY] }
    val currentUserName: Flow<String?> = dataStore.data.map { it[USER_NAME_KEY] }
    val currentServerUrl: Flow<String?> = dataStore.data.map { it[CURRENT_SERVER_URL_KEY] }
    val currentProfileAvatar: Flow<SavedProfileAvatar?> = dataStore.data.map { preferences ->
        val serverUrl = preferences[CURRENT_SERVER_URL_KEY]
        val userId = preferences[USER_ID_KEY]
        preferences.storedProfileSessions()
            .firstOrNull { it.serverUrl == serverUrl && it.userId == userId }
            ?.savedAvatar()
    }
    val savedProfiles: Flow<List<SavedProfile>> = dataStore.data.map { preferences ->
        preferences.storedProfileSessions().map { session ->
            SavedProfile(session.serverUrl, session.userId, session.name, session.savedAvatar())
        }
    }

    fun savedProfilesForServer(serverUrl: String): Flow<List<SavedProfile>> = savedProfiles.map { profiles ->
        profiles.filter { it.serverUrl == serverUrl }
    }

    suspend fun save(token: TokenResponse) {
        dataStore.edit { prefs ->
            prefs[ACCESS_TOKEN_KEY] = token.accessToken
            prefs[REFRESH_TOKEN_KEY] = token.refreshToken
            prefs[TOKEN_TYPE_KEY] = token.tokenType
            prefs.currentStoredProfile(token)?.let { session ->
                prefs[SAVED_PROFILE_SESSIONS_KEY] = profileJson.encodeToString(
                    prefs.storedProfileSessions().upsert(session),
                )
            }
        }
    }

    suspend fun saveIdentity(userId: String, displayName: String?, serverUrl: String? = null) {
        dataStore.edit { prefs ->
            prefs[USER_ID_KEY] = userId
            if (displayName.isNullOrBlank()) prefs.remove(USER_NAME_KEY)
            else prefs[USER_NAME_KEY] = displayName
            serverUrl?.takeIf(String::isNotBlank)?.let { prefs[CURRENT_SERVER_URL_KEY] = it }
            prefs.currentStoredProfile()?.let { session ->
                prefs[SAVED_PROFILE_SESSIONS_KEY] = profileJson.encodeToString(
                    prefs.storedProfileSessions().upsert(session),
                )
            }
        }
    }

    suspend fun bindCurrentServer(serverUrl: String) {
        if (serverUrl.isBlank()) return
        dataStore.edit { prefs ->
            val currentSession = prefs.currentStoredProfile()
            if (
                prefs[CURRENT_SERVER_URL_KEY] == serverUrl &&
                currentSession != null &&
                currentSession in prefs.storedProfileSessions()
            ) {
                return@edit
            }
            prefs[CURRENT_SERVER_URL_KEY] = serverUrl
            prefs.currentStoredProfile()?.let { session ->
                prefs[SAVED_PROFILE_SESSIONS_KEY] = profileJson.encodeToString(
                    prefs.storedProfileSessions().upsert(session),
                )
            }
        }
    }

    suspend fun activateProfile(serverUrl: String, userId: String): Boolean {
        var activated = false
        dataStore.edit { prefs ->
            val session = prefs.storedProfileSessions().firstOrNull {
                it.serverUrl == serverUrl && it.userId == userId
            } ?: return@edit
            prefs[ACCESS_TOKEN_KEY] = session.accessToken
            prefs[REFRESH_TOKEN_KEY] = session.refreshToken
            prefs[TOKEN_TYPE_KEY] = session.tokenType
            prefs[USER_ID_KEY] = session.userId
            if (session.name.isNullOrBlank()) prefs.remove(USER_NAME_KEY)
            else prefs[USER_NAME_KEY] = session.name
            prefs[CURRENT_SERVER_URL_KEY] = session.serverUrl
            activated = true
        }
        return activated
    }

    suspend fun isProfileSaved(serverUrl: String, userId: String): Boolean =
        dataStore.data.first().storedProfileSessions().any {
            it.serverUrl == serverUrl && it.userId == userId
        }

    suspend fun saveProfileAvatar(serverUrl: String, userId: String, avatar: SavedProfileAvatar) {
        if (serverUrl.isBlank() || userId.isBlank() || avatar.kind.isBlank() || avatar.value.isBlank()) return
        dataStore.edit { prefs ->
            val sessions = prefs.storedProfileSessions()
            val index = sessions.indexOfFirst { it.serverUrl == serverUrl && it.userId == userId }
            if (index < 0) return@edit
            prefs[SAVED_PROFILE_SESSIONS_KEY] = profileJson.encodeToString(
                sessions.toMutableList().apply {
                    this[index] = this[index].copy(avatarKind = avatar.kind, avatarValue = avatar.value)
                },
            )
        }
    }

    suspend fun logoutProfile(serverUrl: String, userId: String) {
        dataStore.edit { prefs ->
            val remaining = prefs.storedProfileSessions().filterNot {
                it.serverUrl == serverUrl && it.userId == userId
            }
            prefs[SAVED_PROFILE_SESSIONS_KEY] = profileJson.encodeToString(remaining)
            if (prefs[CURRENT_SERVER_URL_KEY] == serverUrl && prefs[USER_ID_KEY] == userId) {
                prefs.clearCurrentSession()
            }
        }
    }

    suspend fun clearCurrent() {
        dataStore.edit(MutablePreferences::clearCurrentSession)
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
            val serverUrl = prefs[CURRENT_SERVER_URL_KEY]
            val userId = prefs[USER_ID_KEY]
            if (serverUrl != null && userId != null) {
                prefs[SAVED_PROFILE_SESSIONS_KEY] = profileJson.encodeToString(
                    prefs.storedProfileSessions().filterNot {
                        it.serverUrl == serverUrl && it.userId == userId
                    },
                )
            }
            prefs.clearCurrentSession()
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

    internal companion object {
        val ACCESS_TOKEN_KEY = stringPreferencesKey("streamarr_access_token")
        val REFRESH_TOKEN_KEY = stringPreferencesKey("streamarr_refresh_token")
        val TOKEN_TYPE_KEY = stringPreferencesKey("streamarr_token_type")
        val DEVICE_ID_KEY = stringPreferencesKey("streamarr_device_id")
        val USER_ID_KEY = stringPreferencesKey("streamarr_user_id")
        val USER_NAME_KEY = stringPreferencesKey("streamarr_user_name")
        val CURRENT_SERVER_URL_KEY = stringPreferencesKey("streamarr_current_server_url")
        val SAVED_PROFILE_SESSIONS_KEY = stringPreferencesKey("streamarr_saved_profile_sessions")
        val profileJson = Json { ignoreUnknownKeys = true }
    }
}

private fun Preferences.storedProfileSessions(): List<StoredProfileSession> =
    this[TokenStore.SAVED_PROFILE_SESSIONS_KEY]
        ?.let { encoded -> runCatching { TokenStore.profileJson.decodeFromString<List<StoredProfileSession>>(encoded) }.getOrNull() }
        .orEmpty()

private fun Preferences.currentStoredProfile(token: TokenResponse? = null): StoredProfileSession? {
    val serverUrl = this[TokenStore.CURRENT_SERVER_URL_KEY]?.takeIf(String::isNotBlank) ?: return null
    val userId = this[TokenStore.USER_ID_KEY]?.takeIf(String::isNotBlank) ?: return null
    val accessToken = token?.accessToken ?: this[TokenStore.ACCESS_TOKEN_KEY] ?: return null
    val refreshToken = token?.refreshToken ?: this[TokenStore.REFRESH_TOKEN_KEY] ?: return null
    val tokenType = token?.tokenType ?: this[TokenStore.TOKEN_TYPE_KEY] ?: return null
    return StoredProfileSession(serverUrl, userId, this[TokenStore.USER_NAME_KEY], accessToken, refreshToken, tokenType)
}

private fun List<StoredProfileSession>.upsert(session: StoredProfileSession): List<StoredProfileSession> {
    val previous = firstOrNull { it.serverUrl == session.serverUrl && it.userId == session.userId }
    val merged = session.copy(
        avatarKind = session.avatarKind ?: previous?.avatarKind,
        avatarValue = session.avatarValue ?: previous?.avatarValue,
    )
    return filterNot { it.serverUrl == session.serverUrl && it.userId == session.userId } + merged
}

private fun StoredProfileSession.savedAvatar(): SavedProfileAvatar? {
    val kind = avatarKind?.takeIf(String::isNotBlank) ?: return null
    val value = avatarValue?.takeIf(String::isNotBlank) ?: return null
    return SavedProfileAvatar(kind, value)
}

private fun MutablePreferences.clearCurrentSession() {
    remove(TokenStore.ACCESS_TOKEN_KEY)
    remove(TokenStore.REFRESH_TOKEN_KEY)
    remove(TokenStore.TOKEN_TYPE_KEY)
    remove(TokenStore.USER_ID_KEY)
    remove(TokenStore.USER_NAME_KEY)
    remove(TokenStore.CURRENT_SERVER_URL_KEY)
}
