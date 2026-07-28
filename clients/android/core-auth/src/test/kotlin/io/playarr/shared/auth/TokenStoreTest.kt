package io.playarr.shared.auth

import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.emptyPreferences
import io.playarr.shared.auth.model.TokenResponse
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

private class TokenStoreFakeDataStore : DataStore<Preferences> {
    private val state = MutableStateFlow(emptyPreferences())
    override val data: Flow<Preferences> = state

    override suspend fun updateData(transform: suspend (Preferences) -> Preferences): Preferences {
        val updated = transform(state.value)
        state.value = updated
        return updated
    }
}

class TokenStoreTest {
    @Test
    fun `saved profiles survive clearing the active session and can be restored`() = runBlocking {
        val store = TokenStore(TokenStoreFakeDataStore())
        store.save(token("access-a", "refresh-a"))
        store.saveIdentity("profile-a", "Alex", "https://playarr.example")
        store.clearCurrent()
        store.save(token("access-b", "refresh-b"))
        store.saveIdentity("profile-b", "Bailey", "https://playarr.example")
        store.clearCurrent()

        assertEquals(
            listOf("profile-a", "profile-b"),
            store.savedProfilesForServer("https://playarr.example").first().map(SavedProfile::userId),
        )
        assertTrue(store.activateProfile("https://playarr.example", "profile-a"))
        assertEquals("access-a", store.accessToken.first())
        assertEquals("refresh-a", store.refreshToken.first())
        assertEquals("Alex", store.currentUserName.first())
    }

    @Test
    fun `token rotation updates only the active saved profile`() = runBlocking {
        val store = TokenStore(TokenStoreFakeDataStore())
        store.save(token("old-access", "old-refresh"))
        store.saveIdentity("profile-a", "Alex", "https://playarr.example")

        store.save(token("new-access", "new-refresh"))
        store.clearCurrent()
        assertTrue(store.activateProfile("https://playarr.example", "profile-a"))

        assertEquals("new-access", store.accessToken.first())
        assertEquals("new-refresh", store.refreshToken.first())
    }

    @Test
    fun `profile avatars survive token rotation and remain scoped by server and profile`() = runBlocking {
        val store = TokenStore(TokenStoreFakeDataStore())
        store.save(token("old-access", "old-refresh"))
        store.saveIdentity("profile-a", "Alex", "https://playarr.example")
        store.saveProfileAvatar(
            "https://playarr.example",
            "profile-a",
            SavedProfileAvatar("preset", "robot"),
        )

        store.save(token("new-access", "new-refresh"))

        assertEquals(SavedProfileAvatar("preset", "robot"), store.currentProfileAvatar.first())
        assertEquals(
            SavedProfileAvatar("preset", "robot"),
            store.savedProfilesForServer("https://playarr.example").first().single().avatar,
        )
        assertEquals(emptyList<SavedProfile>(), store.savedProfilesForServer("https://other.example").first())
    }

    @Test
    fun `binding a server migrates an existing single active profile`() = runBlocking {
        val store = TokenStore(TokenStoreFakeDataStore())
        store.save(token("access-a", "refresh-a"))
        store.saveIdentity("profile-a", "Alex")

        store.bindCurrentServer("https://playarr.example")

        assertTrue(store.isProfileSaved("https://playarr.example", "profile-a"))
    }

    @Test
    fun `logging out one profile preserves the others and clears it only when active`() = runBlocking {
        val store = TokenStore(TokenStoreFakeDataStore())
        store.save(token("access-a", "refresh-a"))
        store.saveIdentity("profile-a", "Alex", "https://playarr.example")
        store.clearCurrent()
        store.save(token("access-b", "refresh-b"))
        store.saveIdentity("profile-b", "Bailey", "https://playarr.example")

        store.logoutProfile("https://playarr.example", "profile-a")
        assertFalse(store.isProfileSaved("https://playarr.example", "profile-a"))
        assertEquals("profile-b", store.currentUserId.first())

        store.logoutProfile("https://playarr.example", "profile-b")
        assertNull(store.accessToken.first())
        assertEquals(emptyList<SavedProfile>(), store.savedProfiles.first())
    }

    private fun token(access: String, refresh: String) = TokenResponse(
        accessToken = access,
        refreshToken = refresh,
        tokenType = "Bearer",
        expiresIn = 900,
    )
}
