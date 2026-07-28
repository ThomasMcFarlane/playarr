package io.playarr.shared.auth

import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import io.playarr.shared.auth.model.KnownServer
import io.playarr.shared.auth.model.KnownServerGroup
import io.playarr.shared.auth.model.PeerAddressBundle
import javax.inject.Inject
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import kotlinx.serialization.json.Json

/**
 * Persists the remembered *group* of server addresses --
 * `docs/architecture/peer-groups.md` §6.4/§7.1's Android mirror of
 * `clients/tv-web/packages/domain/src/knownServers.ts`. `core-data`'s
 * `ServerConfigStore` still holds the one URL this install is actually
 * dialling right now; this store additionally remembers every other
 * address the same account can be reached at, so a refresh failure
 * (`SessionRefresher`) can retry across the whole group before ever
 * falling back to a full re-login.
 *
 * DataStore-backed on the same `DataStore<Preferences>` singleton
 * `TokenStore` uses (see the app module's `AuthModule.
 * provideClientPrefsDataStore`), storing the group as one JSON blob under
 * a single key -- mirrors `knownServers.ts`'s single `localStorage` key,
 * just keyed into this app's shared preferences file instead of a
 * dedicated one.
 */
class KnownServerGroupStore @Inject constructor(
    private val dataStore: DataStore<Preferences>,
) {
    private val json = Json { ignoreUnknownKeys = true }

    /**
     * The remembered group, if any. Malformed persisted JSON (should
     * never happen, but a hand-edited/corrupted preferences file is not
     * impossible) reads as "nothing remembered" rather than throwing --
     * mirrors `readKnownServers`'s never-throws contract.
     */
    val group: Flow<KnownServerGroup?> = dataStore.data.map { prefs ->
        prefs[KNOWN_SERVER_GROUP_KEY]?.let { raw ->
            runCatching { json.decodeFromString(KnownServerGroup.serializer(), raw) }.getOrNull()
        }
    }

    /** Persists [group] wholesale, replacing whatever (if anything) was remembered before. Mirrors `knownServers.ts`'s `rememberGroup`. */
    suspend fun rememberGroup(group: KnownServerGroup) {
        dataStore.edit { it[KNOWN_SERVER_GROUP_KEY] = json.encodeToString(KnownServerGroup.serializer(), group) }
    }

    /**
     * Records a successful call against [url]: bumps that address's
     * `lastSuccessAt` and promotes it to `lastGoodUrl` so it's tried
     * first next time (the §7.1 fast path), without physically
     * reordering `servers` itself. A no-op when no group is remembered
     * yet -- there is nothing to update, and this deliberately never
     * materializes a one-server group out of a bare URL; that's
     * [rememberGroup]'s job. Mirrors `knownServers.ts`'s
     * `rememberServerSuccess`.
     */
    suspend fun rememberServerSuccess(url: String) {
        val current = group.first() ?: return
        val now = System.currentTimeMillis()
        rememberGroup(
            current.copy(
                servers = current.servers.map { server ->
                    if (server.url == url) server.copy(lastSuccessAt = now) else server
                },
                lastGoodUrl = url,
            ),
        )
    }

    /**
     * Self-heals the remembered group's `groupId`/`groupName`/`servers`
     * from a login/refresh response's [bundle] (§7.1), picking up newly
     * added or removed peers without a separate round trip. Leaves
     * `lastGoodUrl` untouched when it is still one of [bundle]'s
     * addresses (still a valid fast path) and drops it otherwise -- this
     * overload has no way to know *which* address the response carrying
     * [bundle] actually arrived over; see [rememberServerSuccess] for the
     * call used where that is known (`SessionRefresher`'s per-address
     * retry loop). A no-op when [bundle] is `null`, i.e. a standalone
     * node -- see [PeerAddressBundle]'s KDoc for why the server only ever
     * attaches one once actually grouped.
     */
    suspend fun rememberPeerAddresses(bundle: PeerAddressBundle?) {
        if (bundle == null) return
        val previous = group.first()
        val previousSuccessByUrl = previous?.servers?.associate { it.url to it.lastSuccessAt }.orEmpty()
        val bundleUrls = bundle.addresses.map { it.url }
        rememberGroup(
            KnownServerGroup(
                groupId = bundle.groupId,
                groupName = bundle.groupName,
                servers = bundle.addresses.map { entry ->
                    KnownServer(
                        url = entry.url,
                        lastSuccessAt = previousSuccessByUrl[entry.url],
                        peerNodeId = entry.peerNodeId,
                    )
                },
                lastGoodUrl = previous?.lastGoodUrl?.takeIf { it in bundleUrls },
            ),
        )
    }

    /** Explicit manual reset -- the only recovery path if a group becomes fully defunct. Mirrors `knownServers.ts`'s `forgetGroup`. */
    suspend fun forgetGroup() {
        dataStore.edit { it.remove(KNOWN_SERVER_GROUP_KEY) }
    }

    private companion object {
        val KNOWN_SERVER_GROUP_KEY = stringPreferencesKey("playarr_known_server_group")
    }
}
