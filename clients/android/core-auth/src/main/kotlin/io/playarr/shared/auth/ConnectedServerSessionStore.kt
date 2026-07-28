package io.playarr.shared.auth

import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import io.playarr.shared.auth.model.ConnectedServerSession
import io.playarr.shared.auth.model.ConnectedServerSummary
import javax.inject.Inject
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json

/** Local, profile-scoped persistence for independently authenticated secondary servers. */
class ConnectedServerSessionStore @Inject constructor(
    private val dataStore: DataStore<Preferences>,
) {
    private val json = Json { ignoreUnknownKeys = true }
    private val serializer = ListSerializer(ConnectedServerSession.serializer())

    val sessions: Flow<List<ConnectedServerSession>> = dataStore.data.map { preferences ->
        preferences[CONNECTED_SERVER_SESSIONS_KEY]?.let { raw ->
            runCatching { json.decodeFromString(serializer, raw) }.getOrNull()
        }.orEmpty()
    }

    fun sessionsForProfile(profileUserId: String): Flow<List<ConnectedServerSession>> = sessions.map { rows ->
        rows.filter { it.profileUserId == profileUserId }
    }

    fun summariesForProfile(profileUserId: String): Flow<List<ConnectedServerSummary>> =
        sessionsForProfile(profileUserId).map { rows ->
            rows.map { ConnectedServerSummary(it.serverUrl, it.username) }
        }

    suspend fun find(profileUserId: String, serverUrl: String): ConnectedServerSession? =
        sessions.first().firstOrNull { it.profileUserId == profileUserId && it.serverUrl == serverUrl }

    suspend fun upsert(session: ConnectedServerSession) {
        update { rows ->
            rows.filterNot {
                it.profileUserId == session.profileUserId && it.serverUrl == session.serverUrl
            } + session
        }
    }

    suspend fun disconnect(profileUserId: String, serverUrl: String) {
        update { rows ->
            rows.filterNot { it.profileUserId == profileUserId && it.serverUrl == serverUrl }
        }
    }

    suspend fun clearProfile(profileUserId: String) {
        update { rows -> rows.filterNot { it.profileUserId == profileUserId } }
    }

    private suspend fun update(transform: (List<ConnectedServerSession>) -> List<ConnectedServerSession>) {
        dataStore.edit { preferences ->
            val current = preferences[CONNECTED_SERVER_SESSIONS_KEY]?.let { raw ->
                runCatching { json.decodeFromString(serializer, raw) }.getOrNull()
            }.orEmpty()
            val next = transform(current)
            if (next.isEmpty()) preferences.remove(CONNECTED_SERVER_SESSIONS_KEY)
            else preferences[CONNECTED_SERVER_SESSIONS_KEY] = json.encodeToString(serializer, next)
        }
    }

    private companion object {
        val CONNECTED_SERVER_SESSIONS_KEY = stringPreferencesKey("playarr_connected_server_sessions_v1")
    }
}
