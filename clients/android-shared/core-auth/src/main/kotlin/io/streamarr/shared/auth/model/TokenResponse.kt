package io.streamarr.shared.auth.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * Successful response body for `POST /api/auth/device/token` (device flow)
 * and `POST /api/auth/token/refresh` (rotation). See
 * `docs/architecture/auth-modes.md` ("JWT + refresh token design"): the
 * access token is a short-lived (default 15 min) JWT, the refresh token is
 * an opaque 256-bit random value with rotate-on-use + reuse detection.
 */
@Serializable
data class TokenResponse(
    @SerialName("access_token") val accessToken: String,
    @SerialName("refresh_token") val refreshToken: String,
    @SerialName("token_type") val tokenType: String,
    /** Access token lifetime in seconds. */
    @SerialName("expires_in") val expiresIn: Int,
)

/**
 * Error body for `POST /api/auth/device/token` while the flow hasn't
 * concluded (RFC 8628 §3.5): `{"error": "authorization_pending"}` etc.
 * Not a Kotlin exception type on purpose -- these are expected, routine
 * states of an in-progress poll loop, not failures.
 */
@Serializable
data class DeviceTokenErrorBody(
    val error: String,
)
