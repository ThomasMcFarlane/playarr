package io.streamarr.shared.auth.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * Every first-party Playarr client surface, mirroring
 * `io.streamarr.shared.data.model.ClientPlatform`. Duplicated here (rather
 * than depending on `core-data`) so a device can complete the whole RFC
 * 8628 pairing flow with only `core-auth` on its classpath -- see
 * [io.streamarr.shared.auth.remote.AuthHttpClient]'s KDoc for the same
 * independence rationale applied to the rest of this module.
 */
@Serializable
enum class ClientPlatform {
    @SerialName("android-mobile") AndroidMobile,
    @SerialName("android-tv") AndroidTv,
    @SerialName("ios") Ios,
    @SerialName("web") Web,
    @SerialName("tv-webos") TvWebos,
    @SerialName("tv-tizen") TvTizen,
    @SerialName("tv-vidaa") TvVidaa,
}

/** Body for `POST /api/v1/oauth/device/code` -- mirrors `DeviceCodeRequest`. */
@Serializable
data class DeviceCodeRequest(
    @SerialName("client_platform") val clientPlatform: ClientPlatform,
)

/**
 * Response body for `POST /api/v1/oauth/device/code`, per RFC 8628 §3.2
 * and `DeviceCodeResponseSchema`. Issued once when a TV (or any device
 * that can't reasonably accept text input) begins the pairing flow. Every
 * field is required by the real spec -- including
 * [verificationUriComplete], which RFC 8628 itself makes optional but this
 * server always populates.
 */
@Serializable
data class DeviceCodeResponse(
    @SerialName("device_code") val deviceCode: String,
    /** Short code the user types at [verificationUri], or that's embedded in the QR code for [verificationUriComplete]. */
    @SerialName("user_code") val userCode: String,
    @SerialName("verification_uri") val verificationUri: String,
    /** [verificationUri] with [userCode] pre-filled, for QR-code rendering. */
    @SerialName("verification_uri_complete") val verificationUriComplete: String,
    /** Seconds until [deviceCode] expires and the whole flow must restart. */
    @SerialName("expires_in") val expiresIn: Long,
    /** Minimum seconds the client must wait between polls of `POST /api/v1/oauth/token`. */
    val interval: Long,
)
