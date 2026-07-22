package io.streamarr.mobile.connected

import io.streamarr.shared.auth.ConnectedServerSessionManager
import io.streamarr.shared.auth.ConnectedServerSessionStore
import io.streamarr.shared.data.model.ClientPlatform
import io.streamarr.shared.data.remote.StreamarrApi
import io.streamarr.shared.data.remote.StreamarrHttpClient
import java.util.concurrent.ConcurrentHashMap
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking

internal data class PlayarrServerClient(
    val profileUserId: String,
    val url: String,
    val username: String,
    val api: StreamarrApi,
    val accessToken: suspend () -> String?,
    val primary: Boolean = false,
)

/** Builds token-rotating Retrofit clients for the active profile's secondary servers. */
internal class ConnectedServerApiFactory(
    private val store: ConnectedServerSessionStore,
    private val sessionManager: ConnectedServerSessionManager,
    private val clientPlatform: ClientPlatform,
    private val clientVersion: String,
) {
    private val clients = ConcurrentHashMap<String, StreamarrApi>()

    suspend fun clientsForProfile(profileUserId: String): List<PlayarrServerClient> =
        store.sessionsForProfile(profileUserId).first().map { session ->
            val cacheKey = "$profileUserId\u0000${session.serverUrl}"
            PlayarrServerClient(
                profileUserId = profileUserId,
                url = session.serverUrl,
                username = session.username,
                api = clients.getOrPut(cacheKey) {
                    StreamarrHttpClient.create(
                        baseUrlProvider = { session.serverUrl },
                        clientPlatform = clientPlatform,
                        clientVersion = clientVersion,
                        accessTokenProvider = {
                            runBlocking { store.find(profileUserId, session.serverUrl)?.accessToken }
                        },
                        refreshAccessToken = { rejectedToken ->
                            runBlocking {
                                sessionManager.refresh(profileUserId, session.serverUrl, rejectedToken)
                            }
                        },
                        enableHttpLogging = false,
                    )
                },
                accessToken = { store.find(profileUserId, session.serverUrl)?.accessToken },
            )
        }
}
