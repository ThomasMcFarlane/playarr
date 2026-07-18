package io.streamarr.shared.auth

import io.streamarr.shared.auth.model.RefreshRequest
import io.streamarr.shared.auth.model.toTokenResponse
import io.streamarr.shared.auth.remote.RefreshApi
import javax.inject.Inject
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import retrofit2.HttpException

/** Refreshes and rotates one native client's token pair after an authenticated request receives 401. */
class SessionRefresher @Inject constructor(
    private val refreshApi: RefreshApi,
    private val tokenStore: TokenStore,
) {
    private val mutex = Mutex()

    suspend fun refreshAccessToken(rejectedAccessToken: String?): String? = mutex.withLock {
        val currentAccessToken = tokenStore.accessToken.first()

        // A concurrent request may already have completed the single-use
        // refresh-token rotation. Reuse its result instead of redeeming the
        // now-retired token again and revoking the entire token family.
        if (!currentAccessToken.isNullOrBlank() && currentAccessToken != rejectedAccessToken) {
            return@withLock currentAccessToken
        }

        val refreshToken = tokenStore.refreshToken.first()?.takeIf { it.isNotBlank() }
            ?: return@withLock null
        val response = try {
            refreshApi.refresh(
                RefreshRequest(
                    deviceId = tokenStore.getOrCreateDeviceId(),
                    refreshToken = refreshToken,
                ),
            )
        } catch (error: Exception) {
            // A rejected refresh token is the real end of the session. A
            // network failure is not: retain it so a later retry can recover.
            if (error is HttpException && error.code() == 401) tokenStore.clear()
            return@withLock null
        }

        tokenStore.save(response.toTokenResponse())
        response.accessToken
    }
}
