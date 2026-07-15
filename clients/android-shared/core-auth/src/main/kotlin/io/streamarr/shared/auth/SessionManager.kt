package io.streamarr.shared.auth

import io.streamarr.shared.auth.model.ClientPlatform
import io.streamarr.shared.auth.model.LoginRequest
import io.streamarr.shared.auth.model.toTokenResponse
import io.streamarr.shared.auth.remote.LoginApi
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
 * caller downstream (`core-data`'s `StreamarrHttpClient`, in particular).
 *
 * Callers (see `mobile-android`/`tv-android`'s `NetworkModule`) are
 * expected to invoke [ensureAccessToken] from the same place
 * `StreamarrHttpClient`'s `accessTokenProvider` already runs, i.e.
 * synchronously off the main thread inside an OkHttp interceptor -- this
 * class stays entirely suspend-based and leaves the blocking to that
 * caller, mirroring how [DeviceAuthClient] and [TokenStore] do too.
 */
class SessionManager @Inject constructor(
    private val loginApi: LoginApi,
    private val tokenStore: TokenStore,
) {
    private val mutex = Mutex()

    /**
     * Returns the currently stored access token if there is one; otherwise
     * attempts a transparent login and returns the freshly issued token.
     * Returns `null` if login itself fails (network error, or a non-default
     * `AuthMode` that actually requires credentials this client doesn't
     * have) -- the caller is expected to proceed without an `Authorization`
     * header in that case and let the real target endpoint 401, rather than
     * this retrying forever or throwing.
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

        val response = runCatching {
            loginApi.login(
                LoginRequest(
                    deviceId = tokenStore.getOrCreateDeviceId(),
                    deviceName = deviceName,
                    clientPlatform = clientPlatform,
                    clientVersion = clientVersion,
                ),
            )
        }.getOrNull() ?: return@withLock null

        tokenStore.save(response.toTokenResponse())
        response.accessToken
    }
}
