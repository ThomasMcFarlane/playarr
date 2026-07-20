package io.streamarr.shared.auth

import io.streamarr.shared.auth.model.ClientPlatform
import io.streamarr.shared.auth.model.DeviceCodeRequest
import io.streamarr.shared.auth.model.DeviceCodeResponse
import io.streamarr.shared.auth.model.DevicePollResult
import io.streamarr.shared.auth.model.DeviceTokenRequest
import io.streamarr.shared.auth.model.OAuthErrorBody
import io.streamarr.shared.auth.remote.DeviceAuthApi
import java.io.IOException
import javax.inject.Inject
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.serialization.json.Json

/**
 * Drives the RFC 8628 device-pairing flow against the real
 * `POST /api/v1/oauth/device/code` / `POST /api/v1/oauth/token` endpoints
 * end to end, including the real `authorization_pending` / `slow_down` /
 * `expired_token` / `access_denied` error codes from
 * `backend/openapi/streamarr.yaml`. [requestDeviceCode] and [pollOnce] are
 * the two calls; [pollUntilResolved] is a convenience wrapper around
 * [pollOnce] implementing the required backoff behaviour (RFC 8628 §3.5)
 * so television pairing UI does not reimplement it.
 */
class DeviceAuthClient @Inject constructor(
    private val api: DeviceAuthApi,
) {
    private val errorBodyJson = Json { ignoreUnknownKeys = true }

    /** Step 1: begin pairing. See [DeviceCodeResponse] for what to show the user. */
    suspend fun requestDeviceCode(clientPlatform: ClientPlatform): DeviceCodeResponse =
        api.requestDeviceCode(DeviceCodeRequest(clientPlatform = clientPlatform))

    /**
     * Step 2, one attempt: poll once for whether pairing has completed.
     * Callers on a tight loop (rather than using [pollUntilResolved])
     * must honour `slow_down`/`authorization_pending` themselves per
     * RFC 8628 §3.5 -- polling faster than the granted `interval` risks
     * the server rate-limiting the device entirely.
     */
    suspend fun pollOnce(deviceCode: String): DevicePollResult {
        val response = try {
            api.pollForToken(DeviceTokenRequest(deviceCode = deviceCode))
        } catch (e: IOException) {
            return DevicePollResult.Failed(e.message ?: "Network error while polling for token")
        }

        if (response.isSuccessful) {
            val token = response.body() ?: return DevicePollResult.Failed("Empty token response body")
            return DevicePollResult.Approved(token)
        }

        val errorBody = response.errorBody()?.string()
        val errorCode = errorBody
            ?.let { runCatching { errorBodyJson.decodeFromString(OAuthErrorBody.serializer(), it) }.getOrNull() }
            ?.error

        return when (errorCode) {
            "authorization_pending" -> DevicePollResult.AuthorizationPending
            "slow_down" -> DevicePollResult.SlowDown
            "expired_token" -> DevicePollResult.Expired
            "access_denied" -> DevicePollResult.Denied
            null -> DevicePollResult.Failed("HTTP ${response.code()}")
            // Covers `unsupported_grant_type` (should never happen -- this
            // client always sends the fixed device-code grant type) and any
            // future/unrecognized error code the server might add.
            else -> DevicePollResult.Failed(errorCode)
        }
    }

    /**
     * Polls until the flow resolves (approved, expired, denied, or an
     * unrecoverable failure), emitting each intermediate
     * [DevicePollResult] so the UI can show "waiting for approval..."
     * versus a hard failure. Applies RFC 8628 §3.5 backoff: sleeps
     * `interval` seconds between attempts, and on `slow_down` increases
     * that interval by 5 seconds before the next attempt.
     */
    fun pollUntilResolved(
        deviceCode: String,
        initialIntervalSeconds: Long,
    ): Flow<DevicePollResult> = flow {
        var intervalSeconds = initialIntervalSeconds
        while (true) {
            delay(intervalSeconds * 1000L)
            val result = pollOnce(deviceCode)
            emit(result)
            when (result) {
                is DevicePollResult.AuthorizationPending -> Unit // keep polling at the same interval
                is DevicePollResult.SlowDown -> intervalSeconds += SLOW_DOWN_INCREMENT_SECONDS
                else -> return@flow // terminal: Approved, Expired, Denied, or Failed
            }
        }
    }

    private companion object {
        const val SLOW_DOWN_INCREMENT_SECONDS = 5L
    }
}
