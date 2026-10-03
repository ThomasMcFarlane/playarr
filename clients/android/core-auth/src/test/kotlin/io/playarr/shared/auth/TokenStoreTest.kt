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

    @Test
    fun `signing in a second account on another server keeps the first and tracks per-account tokens`() = runBlocking {
        val store = TokenStore(TokenStoreFakeDataStore())
        val a = store.deviceIdForLogin("https://a.example", "alex")
        store.signIn(token("access-a", "refresh-a"), "user-a", "alex", "https://a.example", a)
        val b = store.deviceIdForLogin("https://b.example", "bailey")
        store.signIn(token("access-b", "refresh-b"), "user-b", "bailey", "https://b.example", b)

        assertEquals(
            listOf("user-a" to "https://a.example", "user-b" to "https://b.example"),
            store.savedProfiles.first().map { it.userId to it.serverUrl },
        )
        assertEquals("refresh-b", store.refreshToken.first())
        assertEquals(b, store.getOrCreateDeviceId())

        assertTrue(store.activateProfile("https://a.example", "user-a"))
        assertEquals("access-a", store.accessToken.first())
        assertEquals("refresh-a", store.refreshToken.first())
        assertEquals("https://a.example", store.currentServerUrl.first())
        assertEquals(a, store.getOrCreateDeviceId())
        assertEquals("https://a.example|user-a", store.currentOwnerKey())
    }

    @Test
    fun `a second account on the same server gets its own device id and never reuses the first`() = runBlocking {
        val store = TokenStore(TokenStoreFakeDataStore())
        val a = store.deviceIdForLogin("https://x.example", "alex")
        store.signIn(token("access-a", "refresh-a"), "user-a", "alex", "https://x.example", a)
        val b = store.deviceIdForLogin("https://x.example", "bailey")
        store.signIn(token("access-b", "refresh-b"), "user-b", "bailey", "https://x.example", b)

        assertTrue(a != b)
        // Re-logging into an existing account (any case) reuses its own id.
        assertEquals(a, store.deviceIdForLogin("https://x.example", "ALEX"))
        assertEquals(b, store.deviceIdForLogin("https://x.example", null, "user-b"))
        // Rotating the active account's tokens leaves the other account's tokens alone.
        store.save(token("access-b2", "refresh-b2"))
        assertTrue(store.activateProfile("https://x.example", "user-a"))
        assertEquals("refresh-a", store.refreshToken.first())
        assertTrue(store.activateProfile("https://x.example", "user-b"))
        assertEquals("refresh-b2", store.refreshToken.first())
    }

    @Test
    fun `legacy single account keeps the install device id and is not displaced by a new login`() = runBlocking {
        val store = TokenStore(TokenStoreFakeDataStore())
        val install = store.getOrCreateDeviceId()
        store.save(token("access-a", "refresh-a"))
        store.saveIdentity("user-a", "alex", "https://x.example")

        assertEquals(install, store.getOrCreateDeviceId())
        assertEquals(install, store.deviceIdForLogin("https://x.example", "alex"))
        val fresh = store.deviceIdForLogin("https://x.example", "bailey")
        assertTrue(fresh != install)
        store.signIn(token("access-b", "refresh-b"), "user-b", "bailey", "https://x.example", fresh)

        assertTrue(store.activateProfile("https://x.example", "user-a"))
        assertEquals(install, store.getOrCreateDeviceId())
        assertEquals(2, store.savedProfiles.first().size)
    }

    @Test
    fun `binding a server never re-files an existing identity under a different server`() = runBlocking {
        val store = TokenStore(TokenStoreFakeDataStore())
        store.signIn(token("access-a", "refresh-a"), "user-a", "alex", "https://a.example", "dev-a")

        store.bindCurrentServer("https://b.example")

        assertEquals(listOf("https://a.example"), store.savedProfiles.first().map { it.serverUrl })
        assertEquals("https://a.example", store.currentServerUrl.first())
    }

    @Test
    fun `signing out the active account removes only that account`() = runBlocking {
        val store = TokenStore(TokenStoreFakeDataStore())
        store.signIn(token("access-a", "refresh-a"), "user-a", "alex", "https://a.example", "dev-a")
        store.signIn(token("access-b", "refresh-b"), "user-b", "bailey", "https://a.example", "dev-b")

        store.clear()

        assertNull(store.accessToken.first())
        assertEquals(listOf("user-a"), store.savedProfiles.first().map { it.userId })
        assertTrue(store.activateProfile("https://a.example", "user-a"))
        assertEquals("dev-a", store.getOrCreateDeviceId())
    }

    private fun token(access: String, refresh: String) = TokenResponse(
        accessToken = access,
        refreshToken = refresh,
        tokenType = "Bearer",
        expiresIn = 900,
    )
}
