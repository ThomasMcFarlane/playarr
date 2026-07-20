package io.streamarr.shared.auth.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * Body for `POST /api/v1/auth/login` -- mirrors `LoginRequest`. Only
 * [deviceId]/[deviceName]/[clientPlatform]/[clientVersion] are required by
 * the real spec; [username]/[password]/[pin]/[profileUserId] are all
 * optional and only consulted by non-default `AuthMode`s (`FullAccount`,
 * `ManagedProfiles` respectively). Under the server's default
 * `AuthMode::TrustedNetwork`, a login from a trusted source IP succeeds
 * with every one of those four left `null` -- see
 * [io.streamarr.shared.auth.SessionManager.ensureAccessToken], the one
 * caller in this app that builds this body.
 */
@Serializable
data class LoginRequest(
    @SerialName("device_id") val deviceId: String,
    @SerialName("device_name") val deviceName: String,
    @SerialName("client_platform") val clientPlatform: ClientPlatform,
    @SerialName("client_version") val clientVersion: String,
    val username: String? = null,
    val password: String? = null,
    val pin: String? = null,
    @SerialName("profile_user_id") val profileUserId: String? = null,
)

/**
 * Successful response body for `POST /api/v1/auth/login` -- mirrors
 * `LoginResponse`. Wire-identical to [TokenResponse] plus [userId]; see
 * [toTokenResponse].
 */
@Serializable
data class LoginResponse(
    @SerialName("access_token") val accessToken: String,
    @SerialName("refresh_token") val refreshToken: String,
    @SerialName("token_type") val tokenType: String,
    /** Access token lifetime in seconds. */
    @SerialName("expires_in") val expiresIn: Long,
    /**
     * Redundant with the access token's own `sub` claim -- present on the
     * wire because the real spec's `LoginResponse` requires it, but nothing
     * in this client reads it directly rather than decoding the token.
     */
    @SerialName("user_id") val userId: String,
)

/** [io.streamarr.shared.auth.TokenStore.save] takes a [TokenResponse]; this is the field-for-field projection that drops [LoginResponse.userId]. */
fun LoginResponse.toTokenResponse(): TokenResponse = TokenResponse(
    accessToken = accessToken,
    refreshToken = refreshToken,
    tokenType = tokenType,
    expiresIn = expiresIn,
)
