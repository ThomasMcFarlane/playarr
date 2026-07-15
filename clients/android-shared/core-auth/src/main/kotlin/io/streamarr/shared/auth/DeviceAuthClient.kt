package io.streamarr.shared.auth

import io.streamarr.shared.auth.model.DeviceAuthorizationResponse
import io.streamarr.shared.auth.model.DevicePollResult
import io.streamarr.shared.auth.model.DeviceTokenErrorBody
import io.streamarr.shared.auth.remote.DeviceAuthApi
import java.io.IOException
import javax.inject.Inject
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.serialization.json.Json

/**
 * Drives the RFC 8628 device-pairing flow described in
 * `docs/architecture/auth-modes.md` end to end. The two methods the task
 * spec calls for -- request a device code, poll for a token -- are
 * [requestDeviceCode] and [pollOnce]; [pollUntilResolved] is a convenience
 * wrapper around [pollOnce] implementing the required backoff behaviour
 * (RFC 8628 §3.5) so `tv-android`'s pairing screen doesn't reimplement it.
 */
class DeviceAuthClient @Inject constructor(
    private val api: DeviceAuthApi,
) {
    private val errorBodyJson = Json { ignoreUnknownKeys = true }

    /** Step 1: begin pairing. See [DeviceAuthorizationResponse] for what to show the user. */
    suspend fun requestDeviceCode(clientId: String): DeviceAuthorizationResponse =
        api.requestDeviceCode(clientId)

    /**
     * Step 2, one attempt: poll once for whether pairing has completed.
     * Callers on a tight loop (rather than using [pollUntilResolved])
     * must honour `slow_down`/`authorization_pending` themselves per
     * RFC 8628 §3.5 -- polling faster than the granted `interval` risks
     * the server rate-limiting the device entirely.
     */
    suspend fun pollOnce(deviceCode: String, clientId: String): DevicePollResult {
        val response = try {
            api.pollForToken(deviceCode = deviceCode, clientId = clientId)
        } catch (e: IOException) {
            return DevicePollResult.Failed(e.message ?: "Network error while polling for token")
        }

        if (response.isSuccessful) {
            val token = response.body() ?: return DevicePollResult.Failed("Empty token response body")
            return DevicePollResult.Approved(token)
        }

        val errorBody = response.errorBody()?.string()
        val errorCode = errorBody
            ?.let { runCatching { errorBodyJson.decodeFromString(DeviceTokenErrorBody.serializer(), it) }.getOrNull() }
            ?.error

        return when (errorCode) {
            "authorization_pending" -> DevicePollResult.AuthorizationPending
            "slow_down" -> DevicePollResult.SlowDown
            "expired_token" -> DevicePollResult.Expired
            "access_denied" -> DevicePollResult.Denied
            null -> DevicePollResult.Failed("HTTP ${response.code()}")
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
        clientId: String,
        initialIntervalSeconds: Int,
    ): Flow<DevicePollResult> = flow {
        var intervalSeconds = initialIntervalSeconds
        while (true) {
            delay(intervalSeconds * 1000L)
            val result = pollOnce(deviceCode, clientId)
            emit(result)
            when (result) {
                is DevicePollResult.AuthorizationPending -> Unit // keep polling at the same interval
                is DevicePollResult.SlowDown -> intervalSeconds += SLOW_DOWN_INCREMENT_SECONDS
                else -> return@flow // terminal: Approved, Expired, Denied, or Failed
            }
        }
    }

    private companion object {
        const val SLOW_DOWN_INCREMENT_SECONDS = 5
    }
}
