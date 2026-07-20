package io.streamarr.shared.auth.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * Body for `POST /api/v1/oauth/token` -- mirrors `DeviceTokenRequest`. Per
 * the real spec, this carries no `client_id` at all (unlike a generic RFC
 * 6749 client-credentials-bearing request); only the device code and the
 * fixed device-code grant type.
 */
@Serializable
data class DeviceTokenRequest(
    @SerialName("device_code") val deviceCode: String,
    @SerialName("grant_type") val grantType: String = DEVICE_CODE_GRANT_TYPE,
) {
    companion object {
        /** The only `grant_type` this server accepts; anything else is rejected `unsupported_grant_type`. */
        const val DEVICE_CODE_GRANT_TYPE = "urn:ietf:params:oauth:grant-type:device_code"
    }
}

/**
 * Successful response body for `POST /api/v1/oauth/token` -- mirrors
 * `TokenResponseSchema`. The access token is a short-lived JWT; the
 * refresh token is an opaque rotate-on-use value (see
 * `docs/architecture/auth-modes.md`'s "JWT + refresh token design").
 */
@Serializable
data class TokenResponse(
    @SerialName("access_token") val accessToken: String,
    @SerialName("refresh_token") val refreshToken: String,
    @SerialName("token_type") val tokenType: String,
    /** Access token lifetime in seconds. */
    @SerialName("expires_in") val expiresIn: Long,
)

/**
 * Error body for `POST /api/v1/oauth/token` while the flow hasn't
 * concluded, or has failed -- mirrors `OAuthErrorBody`. Per RFC 8628 §3.5
 * this is `error` set to one of `authorization_pending` | `slow_down` |
 * `expired_token` | `access_denied`, or RFC 6749 §5.2's
 * `unsupported_grant_type`. Not a Kotlin exception type on purpose --
 * `authorization_pending`/`slow_down` are expected, routine states of an
 * in-progress poll loop, not failures.
 */
@Serializable
data class OAuthErrorBody(
    val error: String,
)
