package io.playarr.shared.auth

import io.playarr.shared.auth.model.ClientPlatform
import io.playarr.shared.auth.model.ConnectedServerSession
import io.playarr.shared.auth.model.ConnectedServerSummary
import io.playarr.shared.auth.model.LoginRequest
import io.playarr.shared.auth.model.RefreshRequest
import io.playarr.shared.auth.model.toTokenResponse
import io.playarr.shared.auth.remote.LoginApiForUrl
import io.playarr.shared.auth.remote.RefreshApiForUrl
import java.util.UUID
import javax.inject.Inject
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import retrofit2.HttpException

/** Authenticates and rotates credentials for independent secondary Playarr servers. */
class ConnectedServerSessionManager @Inject constructor(
    private val store: ConnectedServerSessionStore,
    private val loginApiForUrl: LoginApiForUrl,
    private val refreshApiForUrl: RefreshApiForUrl,
) {
    private val refreshMutex = Mutex()

    suspend fun connect(
        profileUserId: String,
        serverUrl: String,
        username: String,
        password: String,
        clientPlatform: ClientPlatform,
        clientVersion: String,
        deviceName: String,
    ): ConnectedServerSummary {
        require(profileUserId.isNotBlank()) { "Sign in before connecting another server." }
        val existing = store.find(profileUserId, serverUrl)
        val deviceId = existing?.deviceId ?: UUID.randomUUID().toString()
        val response = loginApiForUrl(serverUrl).login(
            LoginRequest(
                deviceId = deviceId,
                deviceName = deviceName,
                clientPlatform = clientPlatform,
                clientVersion = clientVersion,
                username = username,
                password = password,
            ),
        )
        val displayName = username.trim().ifEmpty { "Viewer" }
        store.upsert(
            ConnectedServerSession(
                profileUserId = profileUserId,
                serverUserId = response.userId,
                serverUrl = serverUrl,
                username = displayName,
                deviceId = deviceId,
                accessToken = response.accessToken,
                refreshToken = response.refreshToken,
                tokenType = response.tokenType,
            ),
        )
        return ConnectedServerSummary(serverUrl, displayName)
    }

    suspend fun refresh(
        profileUserId: String,
        serverUrl: String,
        rejectedAccessToken: String?,
    ): String? = refreshMutex.withLock {
        val session = store.find(profileUserId, serverUrl) ?: return@withLock null
        if (session.accessToken.isNotBlank() && session.accessToken != rejectedAccessToken) {
            return@withLock session.accessToken
        }
        val response = try {
            refreshApiForUrl(serverUrl).refresh(
                RefreshRequest(
                    deviceId = session.deviceId,
                    refreshToken = session.refreshToken,
                ),
            )
        } catch (error: HttpException) {
            if (error.code() == 401) store.disconnect(profileUserId, serverUrl)
            return@withLock null
        } catch (_: Exception) {
            return@withLock null
        }
        store.upsert(
            session.copy(serverUserId = response.userId).withTokens(response.toTokenResponse()),
        )
        response.accessToken
    }

    suspend fun disconnect(profileUserId: String, serverUrl: String) {
        store.disconnect(profileUserId, serverUrl)
    }
}
