package io.streamarr.shared.auth

import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.emptyPreferences
import io.streamarr.shared.auth.model.KnownServer
import io.streamarr.shared.auth.model.KnownServerGroup
import io.streamarr.shared.auth.model.PeerAddressBundle
import io.streamarr.shared.auth.model.PeerAddressEntry
import io.streamarr.shared.auth.model.RefreshRequest
import io.streamarr.shared.auth.model.RefreshResponse
import io.streamarr.shared.auth.model.TokenResponse
import io.streamarr.shared.auth.remote.RefreshApi
import java.io.IOException
import java.util.Base64
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import retrofit2.HttpException
import retrofit2.Response

private class RefreshFakeDataStore(initial: Preferences = emptyPreferences()) : DataStore<Preferences> {
    private val state = MutableStateFlow(initial)
    override val data: Flow<Preferences> = state

    override suspend fun updateData(transform: suspend (Preferences) -> Preferences): Preferences {
        val updated = transform(state.value)
        state.value = updated
        return updated
    }
}

/** A [RefreshApi] fake that always throws [HttpException] 401 -- a definitive server rejection. */
private fun rejectingRefreshApi(): RefreshApi = object : RefreshApi {
    override suspend fun refresh(body: RefreshRequest): RefreshResponse {
        throw HttpException(Response.error<RefreshResponse>(401, "{}".toResponseBody("application/json".toMediaType())))
    }
}

/** A [RefreshApi] fake that always throws a plain network [IOException] -- an unreachable address, not a rejection. */
private fun unreachableRefreshApi(): RefreshApi = object : RefreshApi {
    override suspend fun refresh(body: RefreshRequest): RefreshResponse = throw IOException("no route to host")
}

/** Stand-in `peer_node_id` UUIDs -- [decodeAccessTokenIssuerPeerNodeId] only recognizes a UUID-shaped `iss`, mirroring the real EdDSA-issued token contract (`streamarr_auth::jwt`). */
private const val NODE_A_ID = "aaaaaaaa-1111-4111-8111-111111111111"
private const val NODE_B_ID = "bbbbbbbb-2222-4222-8222-222222222222"

/**
 * Builds a syntactically real (unsigned -- the signature segment is
 * meaningless) access token JWT carrying `iss` = [issuingPeerNodeId], so
 * [decodeAccessTokenIssuerPeerNodeId] can decode it exactly the way it
 * would a genuine EdDSA token minted by a grouped node
 * (`streamarr_auth::jwt`'s doc comment). Tests exercising node-scoped
 * retry need this instead of a bare opaque string -- see
 * `Jwt.kt`'s own KDoc for why a non-JWT string decodes to `null` and is
 * therefore never node-scoped.
 */
private fun fakeAccessToken(issuingPeerNodeId: String): String {
    val payload = """{"sub":"11111111-1111-4111-8111-111111111111","iss":"$issuingPeerNodeId"}"""
    val encodedPayload = Base64.getUrlEncoder().withoutPadding().encodeToString(payload.toByteArray())
    return "header.$encodedPayload.signature"
}

class SessionRefresherTest {
    @Test
    fun `refresh rotates and persists both tokens`() = runBlocking {
        val store = tokenStore()
        var captured: RefreshRequest? = null
        val refresher = SessionRefresher(
            refreshApi = object : RefreshApi {
                override suspend fun refresh(body: RefreshRequest): RefreshResponse {
                    captured = body
                    return RefreshResponse("new-access", "new-refresh", "Bearer", 900, "user")
                }
            },
            tokenStore = store,
            knownServerGroupStore = emptyKnownServerGroupStore(),
            refreshApiForUrl = { error("no known group -- should not be called") },
        )

        assertEquals("new-access", refresher.refreshAccessToken("old-access"))
        assertEquals("old-refresh", captured?.refreshToken)
        assertEquals("new-access", store.accessToken.first())
        assertEquals("new-refresh", store.refreshToken.first())
    }

    @Test
    fun `second rejected request reuses token already refreshed by first request`() = runBlocking {
        val store = tokenStore()
        var refreshCalls = 0
        val refresher = SessionRefresher(
            refreshApi = object : RefreshApi {
                override suspend fun refresh(body: RefreshRequest): RefreshResponse {
                    refreshCalls++
                    return RefreshResponse("new-access", "new-refresh", "Bearer", 900, "user")
                }
            },
            tokenStore = store,
            knownServerGroupStore = emptyKnownServerGroupStore(),
            refreshApiForUrl = { error("no known group -- should not be called") },
        )

        assertEquals("new-access", refresher.refreshAccessToken("old-access"))
        assertEquals("new-access", refresher.refreshAccessToken("old-access"))
        assertEquals(1, refreshCalls)
    }

    @Test
    fun `server-rejected refresh clears dead session when no group is remembered`() = runBlocking {
        val store = tokenStore()
        val refresher = SessionRefresher(
            refreshApi = rejectingRefreshApi(),
            tokenStore = store,
            knownServerGroupStore = emptyKnownServerGroupStore(),
            refreshApiForUrl = { error("no known group -- should not be called") },
        )

        assertNull(refresher.refreshAccessToken("old-access"))
        assertNull(store.accessToken.first())
        assertNull(store.refreshToken.first())
    }

    @Test
    fun `retries the same refresh token against another address of the SAME peer node when the default address is unreachable`() =
        runBlocking {
            val accessToken = fakeAccessToken(issuingPeerNodeId = NODE_A_ID)
            val store = tokenStore(accessToken)
            val knownServerGroupStore = knownServerGroupStoreWith(
                KnownServerGroup(
                    groupId = "group-1",
                    servers = listOf(
                        // node-a-lan is a second address of the SAME node the
                        // token was minted by -- worth retrying (§3.7).
                        KnownServer(url = "https://node-a-lan.example", peerNodeId = NODE_A_ID),
                    ),
                ),
            )
            var captured: RefreshRequest? = null
            val refresher = SessionRefresher(
                refreshApi = unreachableRefreshApi(),
                tokenStore = store,
                knownServerGroupStore = knownServerGroupStore,
                refreshApiForUrl = { url ->
                    when (url) {
                        "https://node-a-lan.example" -> object : RefreshApi {
                            override suspend fun refresh(body: RefreshRequest): RefreshResponse {
                                captured = body
                                return RefreshResponse("new-access", "new-refresh", "Bearer", 900, "user")
                            }
                        }
                        else -> error("unexpected candidate $url")
                    }
                },
            )

            assertEquals("new-access", refresher.refreshAccessToken(accessToken))
            // The same, still-unredeemed refresh token was replayed against node-a-lan.
            assertEquals("old-refresh", captured?.refreshToken)
            assertEquals("new-access", store.accessToken.first())
            // node-a-lan is now the fast path for next time.
            assertEquals("https://node-a-lan.example", knownServerGroupStore.group.first()?.lastGoodUrl)
        }

    /**
     * The core property this fix adds: a sibling address attributed to a
     * DIFFERENT peer node is never even tried, let alone treated as a
     * candidate -- its `refreshApiForUrl` fake would `error(...)` if
     * invoked. Per §3.7, node-b's database has no record of a refresh
     * token node-a issued, so trying it is guaranteed busywork, not a
     * recovery attempt.
     */
    @Test
    fun `never retries a refresh against a sibling address attributed to a different peer node`() = runBlocking {
        val accessToken = fakeAccessToken(issuingPeerNodeId = NODE_A_ID)
        val store = tokenStore(accessToken)
        val knownServerGroupStore = knownServerGroupStoreWith(
            KnownServerGroup(
                servers = listOf(KnownServer(url = "https://node-b.example", peerNodeId = NODE_B_ID)),
            ),
        )
        val refresher = SessionRefresher(
            refreshApi = unreachableRefreshApi(),
            tokenStore = store,
            knownServerGroupStore = knownServerGroupStore,
            refreshApiForUrl = { error("node-b was never issued this token -- must not be retried") },
        )

        assertNull(refresher.refreshAccessToken(accessToken))
        // The primary being merely unreachable (not rejected) retains the session.
        assertEquals(accessToken, store.accessToken.first())
        assertEquals("old-refresh", store.refreshToken.first())
    }

    /**
     * Inertness when attribution is simply unavailable: the group has a
     * remembered address, but nothing ties it to the peer node that issued
     * this session (an older bundle predating attribution, or -- as here --
     * a plain non-JWT access token this client can't decode an `iss` claim
     * out of at all). No candidate can be proven same-node, so none is
     * tried, exactly mirroring having no group remembered at all.
     */
    @Test
    fun `does not attempt any cross-address refresh retry when the issuing peer node can't be determined`() = runBlocking {
        val store = tokenStore("old-access")
        val knownServerGroupStore = knownServerGroupStoreWith(
            KnownServerGroup(servers = listOf(KnownServer(url = "https://node-b.example", peerNodeId = NODE_B_ID))),
        )
        val refresher = SessionRefresher(
            refreshApi = unreachableRefreshApi(),
            tokenStore = store,
            knownServerGroupStore = knownServerGroupStore,
            refreshApiForUrl = { error("no decodable issuer -- must not be retried anywhere") },
        )

        assertNull(refresher.refreshAccessToken("old-access"))
        assertEquals("old-access", store.accessToken.first())
        assertEquals("old-refresh", store.refreshToken.first())
    }

    @Test
    fun `returns null without clearing the session when every same-node address is merely unreachable`() = runBlocking {
        val accessToken = fakeAccessToken(issuingPeerNodeId = NODE_B_ID)
        val store = tokenStore(accessToken)
        val knownServerGroupStore = knownServerGroupStoreWith(
            KnownServerGroup(servers = listOf(KnownServer(url = "https://node-b.example", peerNodeId = NODE_B_ID))),
        )
        val refresher = SessionRefresher(
            refreshApi = unreachableRefreshApi(),
            tokenStore = store,
            knownServerGroupStore = knownServerGroupStore,
            refreshApiForUrl = { unreachableRefreshApi() },
        )

        assertNull(refresher.refreshAccessToken(accessToken))
        // A network failure is not a rejection -- the still-valid refresh
        // token is retained so a later call can recover.
        assertEquals(accessToken, store.accessToken.first())
        assertEquals("old-refresh", store.refreshToken.first())
    }

    @Test
    fun `retains the session when the primary address is merely unreachable even if a same-node sibling rejects a stale token`() =
        runBlocking {
            val accessToken = fakeAccessToken(issuingPeerNodeId = NODE_B_ID)
            val store = tokenStore(accessToken)
            val knownServerGroupStore = knownServerGroupStoreWith(
                KnownServerGroup(servers = listOf(KnownServer(url = "https://node-b.example", peerNodeId = NODE_B_ID))),
            )
            val refresher = SessionRefresher(
                refreshApi = unreachableRefreshApi(),
                tokenStore = store,
                knownServerGroupStore = knownServerGroupStore,
                refreshApiForUrl = { rejectingRefreshApi() },
            )

            assertNull(refresher.refreshAccessToken(accessToken))
            // Only the *primary* address's own answer can condemn the
            // session -- a same-node sibling's 401 (e.g. a stale replica,
            // or the token having already rotated there) does not, and the
            // still-valid refresh token is retained so a later call, once
            // the primary recovers, can still succeed.
            assertEquals(accessToken, store.accessToken.first())
            assertEquals("old-refresh", store.refreshToken.first())
        }

    @Test
    fun `clears the session when the primary address itself definitively rejects the token, even with a group remembered`() =
        runBlocking {
            val store = tokenStore()
            val knownServerGroupStore = knownServerGroupStoreWith(
                KnownServerGroup(servers = listOf(KnownServer(url = "https://node-b.example"))),
            )
            val refresher = SessionRefresher(
                refreshApi = rejectingRefreshApi(),
                tokenStore = store,
                knownServerGroupStore = knownServerGroupStore,
                refreshApiForUrl = { unreachableRefreshApi() },
            )

            assertNull(refresher.refreshAccessToken("old-access"))
            // The primary address is the one this client believes issued
            // the session, so its own 401 is a genuine, definitive
            // rejection -- the session is cleared regardless of what
            // happens with any sibling candidates.
            assertNull(store.accessToken.first())
            assertNull(store.refreshToken.first())
        }

    @Test
    fun `folds a successful refresh response's peer_addresses into KnownServerGroupStore`() = runBlocking {
        val store = tokenStore()
        val knownServerGroupStore = emptyKnownServerGroupStore()
        val refresher = SessionRefresher(
            refreshApi = object : RefreshApi {
                override suspend fun refresh(body: RefreshRequest): RefreshResponse = RefreshResponse(
                    "new-access",
                    "new-refresh",
                    "Bearer",
                    900,
                    "user",
                    peerAddresses = PeerAddressBundle(
                        groupId = "group-1",
                        groupName = "Home",
                        addresses = listOf(PeerAddressEntry(peerNodeId = "node-home", url = "https://home.example.com")),
                    ),
                )
            },
            tokenStore = store,
            knownServerGroupStore = knownServerGroupStore,
            refreshApiForUrl = { error("default address succeeded -- should not be called") },
        )

        refresher.refreshAccessToken("old-access")

        assertEquals("group-1", knownServerGroupStore.group.first()?.groupId)
        assertEquals(listOf("https://home.example.com"), knownServerGroupStore.group.first()?.servers?.map { it.url })
    }

    private suspend fun tokenStore(accessToken: String = "old-access"): TokenStore = TokenStore(RefreshFakeDataStore()).also {
        it.save(TokenResponse(accessToken, "old-refresh", "Bearer", 900))
    }

    private fun emptyKnownServerGroupStore(): KnownServerGroupStore = KnownServerGroupStore(RefreshFakeDataStore())

    private suspend fun knownServerGroupStoreWith(group: KnownServerGroup): KnownServerGroupStore =
        KnownServerGroupStore(RefreshFakeDataStore()).also { it.rememberGroup(group) }
}
