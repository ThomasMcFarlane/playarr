package io.streamarr.shared.auth.model

import kotlinx.serialization.Serializable

/**
 * One secondary Playarr server session joined to the active profile.
 *
 * This is deliberately separate from [KnownServerGroup]: a known group is
 * several failover addresses for one deployment, while this record is an
 * independently authenticated server whose catalogue may be joined with the
 * primary server. Passwords are never retained; only the rotating token pair
 * returned by a successful login crosses this local persistence boundary.
 */
@Serializable
data class ConnectedServerSession(
    val profileUserId: String,
    val serverUserId: String,
    val serverUrl: String,
    val username: String,
    val deviceId: String,
    val accessToken: String,
    val refreshToken: String,
    val tokenType: String,
) {
    fun withTokens(token: TokenResponse): ConnectedServerSession = copy(
        accessToken = token.accessToken,
        refreshToken = token.refreshToken,
        tokenType = token.tokenType,
    )
}

/** Token-free projection safe for Settings presentation. */
data class ConnectedServerSummary(
    val serverUrl: String,
    val username: String,
)
