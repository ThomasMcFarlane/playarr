package io.playarr.shared.auth

import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.emptyPreferences
import io.playarr.shared.auth.model.KnownServer
import io.playarr.shared.auth.model.KnownServerGroup
import io.playarr.shared.auth.model.PeerAddressBundle
import io.playarr.shared.auth.model.PeerAddressEntry
import io.playarr.shared.auth.model.candidateUrls
import io.playarr.shared.auth.model.resolveReachableServer
import io.playarr.shared.auth.model.sameNodeCandidateUrls
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * Mirrors [SessionManagerTest]/[SessionRefresherTest]'s hand-rolled-fake
 * style -- no Android `Context`/file, no Robolectric. Named distinctly
 * from those files' own private `FakeDataStore`/`RefreshFakeDataStore`:
 * Kotlin top-level `private` classes are file-*visible* but not
 * file-*namespaced*, so an identical simple name in another file in this
 * same package is a real compile-time redeclaration clash, not just a
 * shadowing concern.
 */
private class KnownServerGroupFakeDataStore(initial: Preferences = emptyPreferences()) : DataStore<Preferences> {
    private val state = MutableStateFlow(initial)
    override val data: Flow<Preferences> = state

    override suspend fun updateData(transform: suspend (Preferences) -> Preferences): Preferences {
        val updated = transform(state.value)
        state.value = updated
        return updated
    }
}

/**
 * Exercises [KnownServerGroupStore] -- the Android mirror of `clients/
 * tv-web/packages/domain/src/knownServers.ts`; test cases intentionally
 * track `knownServers.test.ts`'s own coverage so the two mirrors stay
 * behaviorally identical.
 */
class KnownServerGroupStoreTest {

    @Test
    fun `group is null when nothing has been remembered`() = runBlocking {
        assertNull(KnownServerGroupStore(KnownServerGroupFakeDataStore()).group.first())
    }

    @Test
    fun `round-trips a group written by rememberGroup`() = runBlocking {
        val store = KnownServerGroupStore(KnownServerGroupFakeDataStore())
        val group = KnownServerGroup(
            groupId = "group-1",
            groupName = "Home",
            servers = listOf(KnownServer(url = "https://home.example.com"), KnownServer(url = "http://192.168.1.5:8484")),
            lastGoodUrl = "https://home.example.com",
        )

        store.rememberGroup(group)

        assertEquals(group, store.group.first())
    }

    @Test
    fun `accepts a group with no groupId or groupName -- the standalone-server shape`() = runBlocking {
        val store = KnownServerGroupStore(KnownServerGroupFakeDataStore())
        val group = KnownServerGroup(servers = listOf(KnownServer(url = "http://localhost:8484")))

        store.rememberGroup(group)

        assertEquals(group, store.group.first())
    }

    @Test
    fun `rememberServerSuccess is a no-op when no group is remembered yet`() = runBlocking {
        val store = KnownServerGroupStore(KnownServerGroupFakeDataStore())

        store.rememberServerSuccess("https://home.example.com")

        assertNull(store.group.first())
    }

    @Test
    fun `rememberServerSuccess bumps lastSuccessAt on the matching server and sets lastGoodUrl`() = runBlocking {
        val store = KnownServerGroupStore(KnownServerGroupFakeDataStore())
        store.rememberGroup(
            KnownServerGroup(
                servers = listOf(KnownServer(url = "https://home.example.com"), KnownServer(url = "https://east.example.com")),
            ),
        )

        store.rememberServerSuccess("https://east.example.com")

        val group = store.group.first()
        assertEquals("https://east.example.com", group?.lastGoodUrl)
        val east = group?.servers?.find { it.url == "https://east.example.com" }
        val home = group?.servers?.find { it.url == "https://home.example.com" }
        assert(east?.lastSuccessAt != null)
        assertNull(home?.lastSuccessAt)
    }

    @Test
    fun `rememberServerSuccess promotes the url to lastGoodUrl without reordering servers itself`() = runBlocking {
        val store = KnownServerGroupStore(KnownServerGroupFakeDataStore())
        store.rememberGroup(
            KnownServerGroup(
                servers = listOf(KnownServer(url = "https://home.example.com"), KnownServer(url = "https://east.example.com")),
                lastGoodUrl = "https://home.example.com",
            ),
        )

        store.rememberServerSuccess("https://east.example.com")

        val group = store.group.first()
        assertEquals("https://east.example.com", group?.lastGoodUrl)
        assertEquals(
            listOf("https://home.example.com", "https://east.example.com"),
            group?.servers?.map { it.url },
        )
    }

    @Test
    fun `rememberServerSuccess still updates lastGoodUrl even when the url isn't found among servers`() = runBlocking {
        val store = KnownServerGroupStore(KnownServerGroupFakeDataStore())
        store.rememberGroup(KnownServerGroup(servers = listOf(KnownServer(url = "https://home.example.com"))))

        store.rememberServerSuccess("https://unlisted.example.com")

        assertEquals("https://unlisted.example.com", store.group.first()?.lastGoodUrl)
    }

    @Test
    fun `forgetGroup clears a remembered group`() = runBlocking {
        val store = KnownServerGroupStore(KnownServerGroupFakeDataStore())
        store.rememberGroup(KnownServerGroup(servers = listOf(KnownServer(url = "https://home.example.com"))))

        store.forgetGroup()

        assertNull(store.group.first())
    }

    @Test
    fun `forgetGroup is safe to call when nothing is remembered`() = runBlocking {
        KnownServerGroupStore(KnownServerGroupFakeDataStore()).forgetGroup()
    }

    @Test
    fun `rememberPeerAddresses is a no-op for a null bundle`() = runBlocking {
        val store = KnownServerGroupStore(KnownServerGroupFakeDataStore())

        store.rememberPeerAddresses(null)

        assertNull(store.group.first())
    }

    @Test
    fun `rememberPeerAddresses builds a fresh group from the bundle`() = runBlocking {
        val store = KnownServerGroupStore(KnownServerGroupFakeDataStore())

        store.rememberPeerAddresses(
            PeerAddressBundle(
                groupId = "group-1",
                groupName = "Home",
                addresses = listOf(
                    PeerAddressEntry(peerNodeId = "node-home", url = "https://home.example.com"),
                    PeerAddressEntry(peerNodeId = "node-east", url = "https://east.example.com"),
                ),
            ),
        )

        val group = store.group.first()
        assertEquals("group-1", group?.groupId)
        assertEquals("Home", group?.groupName)
        assertEquals(listOf("https://home.example.com", "https://east.example.com"), group?.servers?.map { it.url })
        // Each server carries the peer node it was attributed to on the wire.
        assertEquals("node-home", group?.servers?.find { it.url == "https://home.example.com" }?.peerNodeId)
        assertEquals("node-east", group?.servers?.find { it.url == "https://east.example.com" }?.peerNodeId)
    }

    @Test
    fun `rememberPeerAddresses preserves lastSuccessAt for addresses that persist across the update`() = runBlocking {
        val store = KnownServerGroupStore(KnownServerGroupFakeDataStore())
        store.rememberGroup(
            KnownServerGroup(servers = listOf(KnownServer(url = "https://home.example.com"))),
        )
        store.rememberServerSuccess("https://home.example.com")
        val previousSuccessAt = store.group.first()?.servers?.first()?.lastSuccessAt

        store.rememberPeerAddresses(
            PeerAddressBundle(
                addresses = listOf(
                    PeerAddressEntry(peerNodeId = "node-home", url = "https://home.example.com"),
                    PeerAddressEntry(peerNodeId = "node-new", url = "https://new-peer.example.com"),
                ),
            ),
        )

        val group = store.group.first()
        assertEquals(previousSuccessAt, group?.servers?.find { it.url == "https://home.example.com" }?.lastSuccessAt)
        assertNull(group?.servers?.find { it.url == "https://new-peer.example.com" }?.lastSuccessAt)
    }

    @Test
    fun `rememberPeerAddresses keeps lastGoodUrl when it is still in the bundle, drops it otherwise`() = runBlocking {
        val store = KnownServerGroupStore(KnownServerGroupFakeDataStore())
        store.rememberGroup(
            KnownServerGroup(servers = listOf(KnownServer(url = "https://home.example.com")), lastGoodUrl = "https://home.example.com"),
        )

        store.rememberPeerAddresses(
            PeerAddressBundle(
                addresses = listOf(
                    PeerAddressEntry(peerNodeId = "node-home", url = "https://home.example.com"),
                    PeerAddressEntry(peerNodeId = "node-east", url = "https://east.example.com"),
                ),
            ),
        )
        assertEquals("https://home.example.com", store.group.first()?.lastGoodUrl)

        // Now home.example.com is removed from the group entirely (e.g. the admin removed that peer).
        store.rememberPeerAddresses(
            PeerAddressBundle(addresses = listOf(PeerAddressEntry(peerNodeId = "node-east", url = "https://east.example.com"))),
        )
        assertNull(store.group.first()?.lastGoodUrl)
    }

    @Test
    fun `resolveReachableServer tries lastGoodUrl first and skips probing servers once it succeeds`() = runBlocking {
        val group = KnownServerGroup(
            servers = listOf(KnownServer(url = "https://home.example.com"), KnownServer(url = "https://east.example.com")),
            lastGoodUrl = "https://east.example.com",
        )
        val probed = mutableListOf<String>()

        val resolved = resolveReachableServer(group) { candidate ->
            probed += candidate
            candidate == "https://east.example.com"
        }

        assertEquals("https://east.example.com", resolved)
        assertEquals(listOf("https://east.example.com"), probed)
    }

    @Test
    fun `resolveReachableServer falls back through servers in order when lastGoodUrl fails`() = runBlocking {
        val group = KnownServerGroup(
            servers = listOf(
                KnownServer(url = "https://home.example.com"),
                KnownServer(url = "https://east.example.com"),
                KnownServer(url = "https://west.example.com"),
            ),
            lastGoodUrl = "https://stale.example.com",
        )
        val probed = mutableListOf<String>()

        val resolved = resolveReachableServer(group) { candidate ->
            probed += candidate
            candidate == "https://west.example.com"
        }

        assertEquals("https://west.example.com", resolved)
        assertEquals(
            listOf("https://stale.example.com", "https://home.example.com", "https://east.example.com", "https://west.example.com"),
            probed,
        )
    }

    @Test
    fun `resolveReachableServer doesn't probe lastGoodUrl twice when it also appears in servers`() = runBlocking {
        val group = KnownServerGroup(
            servers = listOf(KnownServer(url = "https://home.example.com"), KnownServer(url = "https://east.example.com")),
            lastGoodUrl = "https://home.example.com",
        )
        val probed = mutableListOf<String>()

        resolveReachableServer(group) { candidate ->
            probed += candidate
            candidate == "https://east.example.com"
        }

        assertEquals(listOf("https://home.example.com", "https://east.example.com"), probed)
    }

    @Test
    fun `resolveReachableServer returns null once every address has failed`() = runBlocking {
        val group = KnownServerGroup(
            servers = listOf(KnownServer(url = "https://home.example.com"), KnownServer(url = "https://east.example.com")),
            lastGoodUrl = "https://stale.example.com",
        )

        assertNull(resolveReachableServer(group) { false })
    }

    @Test
    fun `resolveReachableServer returns null immediately for an empty group`() = runBlocking {
        assertNull(resolveReachableServer(KnownServerGroup()) { true })
    }

    @Test
    fun `candidateUrls puts lastGoodUrl first then servers in priority order, de-duplicated`() {
        val group = KnownServerGroup(
            servers = listOf(KnownServer(url = "https://home.example.com"), KnownServer(url = "https://east.example.com")),
            lastGoodUrl = "https://east.example.com",
        )

        assertEquals(listOf("https://east.example.com", "https://home.example.com"), group.candidateUrls())
    }

    @Test
    fun `sameNodeCandidateUrls keeps only servers attributed to the given peer node`() {
        val group = KnownServerGroup(
            servers = listOf(
                KnownServer(url = "https://node-a-wan.example.com", peerNodeId = "node-a"),
                KnownServer(url = "https://node-a-lan.example.com", peerNodeId = "node-a"),
                KnownServer(url = "https://node-b.example.com", peerNodeId = "node-b"),
            ),
        )

        assertEquals(
            listOf("https://node-a-wan.example.com", "https://node-a-lan.example.com"),
            group.sameNodeCandidateUrls("node-a"),
        )
    }

    @Test
    fun `sameNodeCandidateUrls includes lastGoodUrl only when it belongs to the given peer node`() {
        val group = KnownServerGroup(
            servers = listOf(
                KnownServer(url = "https://node-a.example.com", peerNodeId = "node-a"),
                KnownServer(url = "https://node-b.example.com", peerNodeId = "node-b"),
            ),
            lastGoodUrl = "https://node-b.example.com",
        )

        // node-b is the fast path in general, but it isn't node-a -- excluded here.
        assertEquals(listOf("https://node-a.example.com"), group.sameNodeCandidateUrls("node-a"))
        assertEquals(listOf("https://node-b.example.com"), group.sameNodeCandidateUrls("node-b"))
    }

    @Test
    fun `sameNodeCandidateUrls is empty when no server carries a matching peerNodeId`() {
        val group = KnownServerGroup(
            servers = listOf(KnownServer(url = "https://home.example.com"), KnownServer(url = "https://east.example.com")),
        )

        assertEquals(emptyList<String>(), group.sameNodeCandidateUrls("node-a"))
    }
}
