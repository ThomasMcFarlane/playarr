package io.playarr.mobile.connected

import io.playarr.shared.auth.SessionRefresher
import io.playarr.shared.auth.TokenStore
import io.playarr.shared.data.config.ServerConfigStore
import io.playarr.shared.data.remote.PlayarrApi
import kotlinx.coroutines.flow.first

/** Produces the active profile's primary client followed by its independent secondary clients. */
internal class PlayarrServerClientProvider(
    private val primary: PlayarrApi,
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
