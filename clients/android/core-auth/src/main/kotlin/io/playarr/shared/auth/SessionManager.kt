package io.playarr.shared.auth

import io.playarr.shared.auth.model.ClientPlatform
import io.playarr.shared.auth.model.LoginRequest
import io.playarr.shared.auth.model.candidateUrls
import io.playarr.shared.auth.model.toTokenResponse
import io.playarr.shared.auth.remote.LoginApi
import io.playarr.shared.auth.remote.LoginApiForUrl
import javax.inject.Inject
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/**
 * Obtains a session transparently when [TokenStore] has no access token
 * yet -- neither from RFC 8628 device-flow pairing ([DeviceAuthClient])
 * nor a prior login -- by calling `POST /api/v1/auth/login` (see
 * [LoginApi]). Under the server's default `AuthMode::TrustedNetwork`, a
 * login call from a trusted source IP succeeds with no credentials at all:
 * [LoginRequest]'s only required fields besides device/client
 * identification are optional and left `null` here.
 *
 * Persists the result through [TokenStore] -- the same store device-flow
 * pairing already writes to -- rather than a second, parallel token store,
 * so whichever path won (pairing or login) is indistinguishable to every
 * caller downstream. Also folds a successful response's `peer_addresses`
 * into [KnownServerGroupStore] (`docs/architecture/peer-groups.md`
 * §6.4/§7.1) -- the self-healing address book that lets a later
 * [SessionRefresher] failure retry across the whole remembered group
 * before ever falling back to a full re-login.
 *
 * Once a peer group is known, a failed login against the default [loginApi]
 * -- the address this client is currently configured against -- retries
 * the identical login request against every OTHER remembered group address
 * (via [loginApiForUrl]) before giving up. Unlike [SessionRefresher]'s
 * refresh retry, this is deliberately **not** scoped to any one peer node:
 * a fresh login is valid at *any* group member, since accounts/policies are
 * synced across the whole group (§3.7/Phase 2) -- the default address being
 * temporarily unreachable is not the same thing as this account having
 * nowhere to sign in.
 *
 * This class stays entirely suspend-based, mirroring how [DeviceAuthClient]
 * and [TokenStore] do too, so a caller that needs to block a synchronous
 * context (e.g. an OkHttp interceptor) on it is free to do so.
 */
class SessionManager @Inject constructor(
    private val loginApi: LoginApi,
    private val tokenStore: TokenStore,
    private val knownServerGroupStore: KnownServerGroupStore,
    private val loginApiForUrl: LoginApiForUrl,
) {
    private val mutex = Mutex()

    /**
     * Returns the currently stored access token if there is one; otherwise
     * attempts a transparent login and returns the freshly issued token.
     * Returns `null` if login itself fails everywhere reachable (network
     * error, or a non-default `AuthMode` that actually requires credentials
     * this client doesn't have) -- the caller is expected to proceed
     * without an `Authorization` header in that case and let the real
     * target endpoint 401, rather than this retrying forever or throwing.
     *
     * Serialized by an internal [Mutex] so concurrent callers (e.g. a
     * submit and an approve firing in the same instant with no token yet)
     * can't each kick off their own login and race to [TokenStore.save].
     */
    suspend fun ensureAccessToken(
        clientPlatform: ClientPlatform,
        clientVersion: String,
        deviceName: String,
    ): String? = mutex.withLock {
        tokenStore.accessToken.first()?.let { return@withLock it }

        val request = LoginRequest(
            deviceId = tokenStore.getOrCreateDeviceId(),
            deviceName = deviceName,
            clientPlatform = clientPlatform,
            clientVersion = clientVersion,
        )

        runCatching { loginApi.login(request) }.getOrNull()?.let { response ->
            tokenStore.save(response.toTokenResponse())
            knownServerGroupStore.rememberPeerAddresses(response.peerAddresses)
            return@withLock response.accessToken
        }

        // The default address may simply be unreachable right now, not a
        // sign this account has nowhere to sign in -- retry the identical
        // login request against every other remembered group address
        // before giving up. Every group member is a valid target for this
        // (unlike a refresh token, §3.7): accounts/policies sync across the
        // whole group (Phase 2).
        val group = knownServerGroupStore.group.first()
        if (group != null) {
            for (url in group.candidateUrls()) {
                val response = runCatching { loginApiForUrl(url).login(request) }.getOrNull() ?: continue
                tokenStore.save(response.toTokenResponse())
                knownServerGroupStore.rememberServerSuccess(url)
                knownServerGroupStore.rememberPeerAddresses(response.peerAddresses)
                return@withLock response.accessToken
            }
        }

        null
    }
}
