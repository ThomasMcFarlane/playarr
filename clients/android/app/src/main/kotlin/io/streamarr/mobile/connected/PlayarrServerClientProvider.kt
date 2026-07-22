package io.streamarr.mobile.connected

import io.streamarr.shared.auth.SessionRefresher
import io.streamarr.shared.auth.TokenStore
import io.streamarr.shared.data.config.ServerConfigStore
import io.streamarr.shared.data.remote.StreamarrApi
import kotlinx.coroutines.flow.first

/** Produces the active profile's primary client followed by its independent secondary clients. */
internal class PlayarrServerClientProvider(
    private val primary: StreamarrApi,
    private val connectedServerApiFactory: ConnectedServerApiFactory,
    private val serverConfigStore: ServerConfigStore,
    private val tokenStore: TokenStore,
    private val sessionRefresher: SessionRefresher,
) {
    suspend fun clients(): List<PlayarrServerClient> {
        val profileUserId = tokenStore.currentUserId.first()
        val primaryClient = PlayarrServerClient(
            profileUserId = profileUserId.orEmpty(),
            url = serverConfigStore.baseUrl.first(),
            username = tokenStore.currentUserName.first() ?: "Viewer",
            api = primary,
            accessToken = { tokenStore.accessToken.first() },
            refreshAccessToken = sessionRefresher::refreshAccessToken,
            primary = true,
        )
        return listOf(primaryClient) + if (profileUserId == null) {
            emptyList()
        } else {
            connectedServerApiFactory.clientsForProfile(profileUserId)
        }
    }
}
