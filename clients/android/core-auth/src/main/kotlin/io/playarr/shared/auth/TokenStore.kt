package io.playarr.shared.auth

import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.MutablePreferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import io.playarr.shared.auth.model.TokenResponse
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
    /**
     * Per-account device id. The server keeps ONE refresh-token family per
     * `device_id`, so two accounts sharing an id revoke each other's refresh
     * token on every login. `null` only for sessions saved before this field
     * existed; those keep using the install-wide id they were issued under.
     */
    val deviceId: String? = null,
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
            decodeAccessTokenDeviceId(token.accessToken)?.let { prefs[CURRENT_DEVICE_ID_KEY] = it }
            prefs.currentStoredProfile(token)?.let { session ->
                prefs[SAVED_PROFILE_SESSIONS_KEY] = profileJson.encodeToString(
                    prefs.storedProfileSessions().upsert(session),
                )
            }
        }
    }

    /**
     * Adds (or refreshes) one account and makes it the active session in a
     * single atomic edit. Unlike [save] followed by [saveIdentity] it never
     * observes the previous account's identity, so it cannot write the new
     * tokens over the old account. Other saved accounts are untouched.
     */
    suspend fun signIn(
        token: TokenResponse,
        userId: String,
        displayName: String?,
        serverUrl: String,
        deviceId: String?,
    ) {
        dataStore.edit { prefs ->
            prefs[ACCESS_TOKEN_KEY] = token.accessToken
            prefs[REFRESH_TOKEN_KEY] = token.refreshToken
            prefs[TOKEN_TYPE_KEY] = token.tokenType
            prefs[USER_ID_KEY] = userId
            if (displayName.isNullOrBlank()) prefs.remove(USER_NAME_KEY) else prefs[USER_NAME_KEY] = displayName
            prefs[CURRENT_SERVER_URL_KEY] = serverUrl
            prefs[BASE_URL_KEY] = serverUrl
            val effective = decodeAccessTokenDeviceId(token.accessToken) ?: deviceId
            if (effective != null) prefs[CURRENT_DEVICE_ID_KEY] = effective else prefs.remove(CURRENT_DEVICE_ID_KEY)
            prefs.currentStoredProfile()?.let { session ->
                prefs[SAVED_PROFILE_SESSIONS_KEY] = profileJson.encodeToString(
                    prefs.storedProfileSessions().upsert(session),
                )
            }
        }
    }

    /**
     * The device id a fresh login for this account must send. Re-logging
     * into an already-saved account (matched by user id, else by name on the
     * same server) reuses its id so the server rotates that account's own
     * family; a genuinely new account gets a new random id so it can never
     * displace another account's refresh token. Legacy accounts saved
     * without an id keep the install-wide id.
     */
    suspend fun deviceIdForLogin(serverUrl: String, username: String? = null, userId: String? = null): String {
        val sessions = dataStore.data.first().storedProfileSessions().filter { it.serverUrl == serverUrl }
        val existing = sessions.firstOrNull { userId != null && it.userId == userId }
            ?: sessions.firstOrNull { !username.isNullOrBlank() && it.name.equals(username, ignoreCase = true) }
        if (existing != null) return existing.deviceId ?: getInstallDeviceId()
        return UUID.randomUUID().toString()
    }

    /** Stable key for per-account local data (offline progress queue). Blank when signed out. */
    suspend fun currentOwnerKey(): String {
        val prefs = dataStore.data.first()
        val server = prefs[CURRENT_SERVER_URL_KEY]?.takeIf(String::isNotBlank) ?: return ""
        val user = prefs[USER_ID_KEY]?.takeIf(String::isNotBlank) ?: return ""
        return "$server|$user"
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
            // Only adopt the configured server for a legacy session that never
            // recorded one. Re-pointing an existing identity at a different
            // server would file its tokens under the wrong (server, user).
            if (!prefs[CURRENT_SERVER_URL_KEY].isNullOrBlank()) return@edit
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
            // Same DataStore as ServerConfigStore: switching accounts on another
            // server must repoint the API base URL in the same atomic edit.
            prefs[BASE_URL_KEY] = session.serverUrl
            if (session.deviceId != null) prefs[CURRENT_DEVICE_ID_KEY] = session.deviceId
            else prefs.remove(CURRENT_DEVICE_ID_KEY)
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
        dataStore.data.first()[CURRENT_DEVICE_ID_KEY]?.let { return it }
        return getInstallDeviceId()
    }

    private suspend fun getInstallDeviceId(): String {
        val existing = dataStore.data.map { it[DEVICE_ID_KEY] }.first()
        if (existing != null) return existing
        val generated = UUID.randomUUID().toString()
        dataStore.edit { it[DEVICE_ID_KEY] = generated }
        return generated
    }

    internal companion object {
        val ACCESS_TOKEN_KEY = stringPreferencesKey("playarr_access_token")
        val REFRESH_TOKEN_KEY = stringPreferencesKey("playarr_refresh_token")
        val TOKEN_TYPE_KEY = stringPreferencesKey("playarr_token_type")
        val DEVICE_ID_KEY = stringPreferencesKey("playarr_device_id")
        val CURRENT_DEVICE_ID_KEY = stringPreferencesKey("playarr_current_device_id")
        /** Owned by core-data's ServerConfigStore; written here only for atomic account switches. */
        val BASE_URL_KEY = stringPreferencesKey("playarr_base_url")
        val USER_ID_KEY = stringPreferencesKey("playarr_user_id")
        val USER_NAME_KEY = stringPreferencesKey("playarr_user_name")
        val CURRENT_SERVER_URL_KEY = stringPreferencesKey("playarr_current_server_url")
        val SAVED_PROFILE_SESSIONS_KEY = stringPreferencesKey("playarr_saved_profile_sessions")
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
    return StoredProfileSession(
        serverUrl, userId, this[TokenStore.USER_NAME_KEY], accessToken, refreshToken, tokenType,
        deviceId = this[TokenStore.CURRENT_DEVICE_ID_KEY],
    )
}

private fun List<StoredProfileSession>.upsert(session: StoredProfileSession): List<StoredProfileSession> {
    val previous = firstOrNull { it.serverUrl == session.serverUrl && it.userId == session.userId }
    val merged = session.copy(
        avatarKind = session.avatarKind ?: previous?.avatarKind,
        avatarValue = session.avatarValue ?: previous?.avatarValue,
        deviceId = session.deviceId ?: previous?.deviceId,
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
    remove(TokenStore.CURRENT_DEVICE_ID_KEY)
}
