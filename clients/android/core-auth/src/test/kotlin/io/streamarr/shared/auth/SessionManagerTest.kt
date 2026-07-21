package io.streamarr.shared.auth

import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.emptyPreferences
import io.streamarr.shared.auth.model.ClientPlatform
import io.streamarr.shared.auth.model.KnownServer
import io.streamarr.shared.auth.model.KnownServerGroup
import io.streamarr.shared.auth.model.LoginRequest
import io.streamarr.shared.auth.model.LoginResponse
import io.streamarr.shared.auth.model.PeerAddressBundle
import io.streamarr.shared.auth.model.PeerAddressEntry
import io.streamarr.shared.auth.remote.LoginApi
import io.streamarr.shared.auth.remote.LoginApiForUrl
import java.io.IOException
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * In-memory [DataStore] fake -- no Android `Context`/file, no Robolectric --
 * so [TokenStore] (and therefore [SessionManager]) can be exercised as
 * plain JVM unit tests, mirroring [DeviceAuthClientTest]'s hand-rolled-fake
 * style rather than pulling in a mocking/instrumentation framework.
 */
private class FakeDataStore(initial: Preferences = emptyPreferences()) : DataStore<Preferences> {
    private val state = MutableStateFlow(initial)
    override val data: Flow<Preferences> = state

    override suspend fun updateData(transform: suspend (Preferences) -> Preferences): Preferences {
        val updated = transform(state.value)
        state.value = updated
        return updated
    }
}

/** Exercises [SessionManager.ensureAccessToken] against a hand-written fake [LoginApi] and a real [TokenStore] backed by [FakeDataStore]. */
class SessionManagerTest {

    private fun sessionManager(
        loginApiForUrl: LoginApiForUrl = LoginApiForUrl { error("no known group -- should not be called") },
        login: suspend (LoginRequest) -> LoginResponse,
    ): Triple<SessionManager, TokenStore, KnownServerGroupStore> {
        val tokenStore = TokenStore(FakeDataStore())
        val knownServerGroupStore = KnownServerGroupStore(FakeDataStore())
        val fakeApi = object : LoginApi {
            override suspend fun login(body: LoginRequest): LoginResponse = login(body)
        }
        return Triple(
            SessionManager(fakeApi, tokenStore, knownServerGroupStore, loginApiForUrl),
            tokenStore,
            knownServerGroupStore,
        )
    }

    @Test
    fun `returns the already-stored access token without calling login`() = runBlocking {
        var loginCalls = 0
        val (sessionManager, tokenStore) = sessionManager {
            loginCalls++
            error("should not be called")
        }
        tokenStore.save(
            io.streamarr.shared.auth.model.TokenResponse(
                accessToken = "paired-token",
                refreshToken = "r",
                tokenType = "Bearer",
                expiresIn = 900,
            ),
        )

        val token = sessionManager.ensureAccessToken(
            clientPlatform = ClientPlatform.AndroidMobile,
            clientVersion = "1.0",
            deviceName = "Pixel",
        )

        assertEquals("paired-token", token)
        assertEquals(0, loginCalls)
    }

    @Test
    fun `with no stored token, calls login and persists the returned token through TokenStore`() = runBlocking {
        var capturedRequest: LoginRequest? = null
        val (sessionManager, tokenStore) = sessionManager { request ->
            capturedRequest = request
            LoginResponse(
                accessToken = "fresh-token",
                refreshToken = "fresh-refresh",
                tokenType = "Bearer",
                expiresIn = 900,
                userId = "u1",
            )
        }

        val token = sessionManager.ensureAccessToken(
            clientPlatform = ClientPlatform.AndroidMobile,
            clientVersion = "1.0",
            deviceName = "Pixel",
        )

        assertEquals("fresh-token", token)
        // The (single) actual API call now carries the token login just issued.
        assertEquals("fresh-token", tokenStore.accessToken.first())
        assertEquals("fresh-refresh", tokenStore.refreshToken.first())

        // Sent no credentials -- trusted-network mode needs none -- but did
        // send real device/client identification, not empty strings.
        assertNull(capturedRequest?.username)
        assertNull(capturedRequest?.password)
        assertNull(capturedRequest?.pin)
        assertEquals(ClientPlatform.AndroidMobile, capturedRequest?.clientPlatform)
        assertEquals("Pixel", capturedRequest?.deviceName)
        assertTrue(capturedRequest?.deviceId?.isNotBlank() == true)
    }

    @Test
    fun `reuses the same device id across two separate login attempts`() = runBlocking {
        val deviceIds = mutableListOf<String>()
        val (sessionManager, tokenStore) = sessionManager { request ->
            deviceIds += request.deviceId
            LoginResponse("t", "r", "Bearer", 900, "u1")
        }

        sessionManager.ensureAccessToken(ClientPlatform.AndroidMobile, "1.0", "Pixel")
        // Simulate the access token expiring/being cleared so a second
        // login is actually attempted, rather than short-circuiting on the
        // token this store already holds.
        tokenStore.clear()
        sessionManager.ensureAccessToken(ClientPlatform.AndroidMobile, "1.0", "Pixel")

        assertEquals(2, deviceIds.size)
        assertEquals(deviceIds[0], deviceIds[1])
    }

    @Test
    fun `returns null without throwing when login itself fails`() = runBlocking {
        val (sessionManager, tokenStore) = sessionManager {
            throw java.io.IOException("no route to host")
        }

        val token = sessionManager.ensureAccessToken(
            clientPlatform = ClientPlatform.AndroidMobile,
            clientVersion = "1.0",
            deviceName = "Pixel",
        )

        assertNull(token)
        assertNull(tokenStore.accessToken.first())
    }

    @Test
    fun `folds a successful login response's peer_addresses into KnownServerGroupStore`() = runBlocking {
        val (sessionManager, _, knownServerGroupStore) = sessionManager {
            LoginResponse(
                accessToken = "fresh-token",
                refreshToken = "fresh-refresh",
                tokenType = "Bearer",
                expiresIn = 900,
                userId = "u1",
                peerAddresses = PeerAddressBundle(
                    groupId = "group-1",
                    groupName = "Home",
                    addresses = listOf(
                        PeerAddressEntry(peerNodeId = "node-home", url = "https://home.example.com"),
                        PeerAddressEntry(peerNodeId = "node-east", url = "https://east.example.com"),
                    ),
                ),
            )
        }

        sessionManager.ensureAccessToken(ClientPlatform.AndroidMobile, "1.0", "Pixel")

        val group = knownServerGroupStore.group.first()
        assertEquals("group-1", group?.groupId)
        assertEquals("Home", group?.groupName)
        assertEquals(
            listOf("https://home.example.com", "https://east.example.com"),
            group?.servers?.map { it.url },
        )
    }

    @Test
    fun `does not remember any group when the login response has no peer_addresses`() = runBlocking {
        val (sessionManager, _, knownServerGroupStore) = sessionManager {
            LoginResponse("t", "r", "Bearer", 900, "u1")
        }

        sessionManager.ensureAccessToken(ClientPlatform.AndroidMobile, "1.0", "Pixel")

        assertNull(knownServerGroupStore.group.first())
    }

    /**
     * The any-node counterpart to `SessionRefresherTest`'s same-node-only
     * scoping: a fresh login is valid at *any* group member (accounts/
     * policies sync, §3.7/Phase 2), so unlike a refresh retry this one is
     * NOT scoped to any particular peer node -- home-b answers even though
     * it belongs to a different node than the default (unreachable) address.
     */
    @Test
    fun `retries a fresh login across every remembered group address regardless of peer node attribution`() =
        runBlocking {
            var capturedRequest: LoginRequest? = null
            val (sessionManager, tokenStore, knownServerGroupStore) = sessionManager(
                loginApiForUrl = LoginApiForUrl { url ->
                    when (url) {
                        "https://node-a.example.com" -> object : LoginApi {
                            override suspend fun login(body: LoginRequest): LoginResponse =
                                throw IOException("no route to host")
                        }
                        "https://node-b.example.com" -> object : LoginApi {
                            override suspend fun login(body: LoginRequest): LoginResponse {
                                capturedRequest = body
                                return LoginResponse("fresh-token", "fresh-refresh", "Bearer", 900, "u1")
                            }
                        }
                        else -> error("unexpected candidate $url")
                    }
                },
            ) {
                throw IOException("no route to host")
            }
            knownServerGroupStore.rememberGroup(
                KnownServerGroup(
                    servers = listOf(
                        KnownServer(url = "https://node-a.example.com", peerNodeId = "node-a"),
                        KnownServer(url = "https://node-b.example.com", peerNodeId = "node-b"),
                    ),
                ),
            )

            val token = sessionManager.ensureAccessToken(ClientPlatform.AndroidMobile, "1.0", "Pixel")

            assertEquals("fresh-token", token)
            assertEquals("fresh-token", tokenStore.accessToken.first())
            assertEquals("Pixel", capturedRequest?.deviceName)
            // node-b becomes the fast path for next time.
            assertEquals("https://node-b.example.com", knownServerGroupStore.group.first()?.lastGoodUrl)
        }

    /** Inertness: with no group remembered at all, a failed login has nothing to retry against and just returns `null`. */
    @Test
    fun `returns null without retrying anywhere when login fails and no group is remembered`() = runBlocking {
        val (sessionManager, tokenStore, knownServerGroupStore) = sessionManager {
            throw IOException("no route to host")
        }

        val token = sessionManager.ensureAccessToken(ClientPlatform.AndroidMobile, "1.0", "Pixel")

        assertNull(token)
        assertNull(tokenStore.accessToken.first())
        assertNull(knownServerGroupStore.group.first())
    }
}
