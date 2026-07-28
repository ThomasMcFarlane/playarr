package io.playarr.shared.auth.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
data class HostedLinkCodeRequest(
    @SerialName("client_platform") val clientPlatform: ClientPlatform,
)

@Serializable
data class HostedLinkCodeResponse(
    @SerialName("device_code") val deviceCode: String,
    @SerialName("user_code") val userCode: String,
    @SerialName("verification_uri") val verificationUri: String,
    @SerialName("verification_uri_complete") val verificationUriComplete: String,
    @SerialName("expires_in") val expiresIn: Long,
    val interval: Long,
)

@Serializable
data class HostedLinkClaim(
    @SerialName("server_url") val serverUrl: String,
    @SerialName("server_device_code") val serverDeviceCode: String,
    @SerialName("server_urls") val serverUrls: List<String>,
)

@Serializable
data class HostedLinkPollResponse(
    @SerialName("server_url") val serverUrl: String? = null,
    @SerialName("server_device_code") val serverDeviceCode: String? = null,
    @SerialName("server_urls") val serverUrls: List<String> = emptyList(),
    val error: String? = null,
) {
    fun claimOrNull(): HostedLinkClaim? = if (serverUrl != null && serverDeviceCode != null) {
        HostedLinkClaim(serverUrl, serverDeviceCode, serverUrls)
    } else {
        null
    }
}

sealed interface HostedLinkPollResult {
    data object AuthorizationPending : HostedLinkPollResult
    data class Approved(val claim: HostedLinkClaim) : HostedLinkPollResult
    data object Expired : HostedLinkPollResult
    data class Failed(val message: String) : HostedLinkPollResult
}
