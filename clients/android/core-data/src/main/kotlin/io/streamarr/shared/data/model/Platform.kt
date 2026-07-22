package io.streamarr.shared.data.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * Kotlin mirror of `streamarr-model::platform`.
 *
 * Every first-party Playarr client surface. Kept as a closed enum (rather
 * than a free-form string) so it agrees with the server's compatibility
 * table and the `X-Streamarr-Client-Platform` header contract. This
 * project only ships [AndroidMobile] and [AndroidTv]; the rest exist here
 * so this module can decode a full [VersionEnvelope] response without
 * dropping data about sibling Playarr clients.
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

/**
 * One platform's row in the compatibility table returned by
 * `GET /api/system/version`: what the latest client build is, the floor
 * below which the version-gate middleware rejects requests outright, and
 * the floor below which it should nag-but-allow.
 */
@Serializable
data class CompatibilityEntry(
    val platform: ClientPlatform,
    val latestVersion: String,
    val minSupportedVersion: String,
    val deprecatedBelow: String? = null,
    /** RFC 3339 timestamp after which `minSupportedVersion` will be ratcheted up. */
    val sunset: String? = null,
)

/** Response body for `GET /api/system/version`. */
@Serializable
data class VersionEnvelope(
    val instanceName: String,
    val serverVersion: String,
    val apiVersion: String,
    val buildSha: String? = null,
    val compatibility: List<CompatibilityEntry> = emptyList(),
)
