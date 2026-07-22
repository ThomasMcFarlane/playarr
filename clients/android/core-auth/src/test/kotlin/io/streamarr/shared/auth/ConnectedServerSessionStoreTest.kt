package io.streamarr.shared.auth

import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.emptyPreferences
import io.streamarr.shared.auth.model.ConnectedServerSession
import io.streamarr.shared.auth.model.TokenResponse
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

private class ConnectedServerSessionFakeDataStore(
    initial: Preferences = emptyPreferences(),
) : DataStore<Preferences> {
    private val state = MutableStateFlow(initial)
    override val data: Flow<Preferences> = state

    override suspend fun updateData(transform: suspend (Preferences) -> Preferences): Preferences {
        return transform(state.value).also { state.value = it }
    }
}

class ConnectedServerSessionStoreTest {
    @Test
    fun `sessions are empty before a server is connected`() = runBlocking {
        assertEquals(emptyList<ConnectedServerSession>(), store().sessions.first())
    }

    @Test
    fun `upsert scopes sessions by active profile and replaces rotated tokens`() = runBlocking {
        val store = store()
        val first = session("profile-a", "https://one.example.com", "access-1")
        val otherProfile = session("profile-b", "https://two.example.com", "access-2")
        store.upsert(first)
        store.upsert(otherProfile)
        store.upsert(
            first.withTokens(
                TokenResponse("access-rotated", "refresh-rotated", "Bearer", expiresIn = 900),
            ),
        )

        assertEquals(listOf("https://one.example.com"), store.summariesForProfile("profile-a").first().map { it.serverUrl })
        assertEquals("access-rotated", store.find("profile-a", "https://one.example.com")?.accessToken)
        assertEquals("access-2", store.find("profile-b", "https://two.example.com")?.accessToken)
    }

    @Test
    fun `disconnect and clear profile never remove another profiles sessions`() = runBlocking {
        val store = store()
        store.upsert(session("profile-a", "https://one.example.com", "access-1"))
        store.upsert(session("profile-a", "https://two.example.com", "access-2"))
        store.upsert(session("profile-b", "https://three.example.com", "access-3"))

        store.disconnect("profile-a", "https://one.example.com")
        assertNull(store.find("profile-a", "https://one.example.com"))
        assertEquals(1, store.sessionsForProfile("profile-a").first().size)

        store.clearProfile("profile-a")
        assertEquals(emptyList<ConnectedServerSession>(), store.sessionsForProfile("profile-a").first())
        assertEquals(1, store.sessionsForProfile("profile-b").first().size)
    }

    private fun store() = ConnectedServerSessionStore(ConnectedServerSessionFakeDataStore())

    private fun session(profile: String, url: String, accessToken: String) = ConnectedServerSession(
        profileUserId = profile,
        serverUserId = "server-$profile",
        serverUrl = url,
        username = profile,
        deviceId = "device-$profile",
        accessToken = accessToken,
        refreshToken = "refresh-$accessToken",
        tokenType = "Bearer",
    )
}
