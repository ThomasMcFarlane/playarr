package io.streamarr.shared.auth.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/** Body for `POST /api/v1/auth/refresh`. */
@Serializable
data class RefreshRequest(
    @SerialName("device_id") val deviceId: String,
    @SerialName("refresh_token") val refreshToken: String,
)

/** Fresh access token plus the rotated refresh token returned by the server. */
@Serializable
data class RefreshResponse(
    @SerialName("access_token") val accessToken: String,
    @SerialName("refresh_token") val refreshToken: String,
    @SerialName("token_type") val tokenType: String,
    @SerialName("expires_in") val expiresIn: Long,
    @SerialName("user_id") val userId: String,
    /**
     * `docs/architecture/peer-groups.md` §7.1's self-healing address
     * book: this node's current [PeerAddressBundle], so
     * [io.streamarr.shared.auth.SessionRefresher] can fold newly
     * added/removed peers into `KnownServerGroupStore` on every
     * successful refresh, not just every login. `null`/absent for a
     * standalone (never grouped) node.
     */
    @SerialName("peer_addresses") val peerAddresses: PeerAddressBundle? = null,
)

fun RefreshResponse.toTokenResponse(): TokenResponse = TokenResponse(
    accessToken = accessToken,
    refreshToken = refreshToken,
    tokenType = tokenType,
    expiresIn = expiresIn,
)
