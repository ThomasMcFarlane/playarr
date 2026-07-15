package io.streamarr.shared.auth.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * Response body for `POST /api/auth/device/authorize`, per RFC 8628 §3.2
 * and `docs/architecture/auth-modes.md`'s worked example. Issued once when
 * a TV (or any device that can't reasonably accept text input) begins the
 * pairing flow.
 */
@Serializable
data class DeviceAuthorizationResponse(
    @SerialName("device_code") val deviceCode: String,
    /** Short code the user types at [verificationUri], or that's embedded in the QR code for [verificationUriComplete]. */
    @SerialName("user_code") val userCode: String,
    @SerialName("verification_uri") val verificationUri: String,
    /** [verificationUri] with [userCode] pre-filled, for QR-code rendering. */
    @SerialName("verification_uri_complete") val verificationUriComplete: String? = null,
    /** Seconds until [deviceCode] expires and the whole flow must restart. */
    @SerialName("expires_in") val expiresIn: Int,
    /** Minimum seconds the client must wait between polls of `/api/auth/device/token`. */
    val interval: Int,
)
