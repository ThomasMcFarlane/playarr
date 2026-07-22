package io.streamarr.shared.auth

import io.streamarr.shared.auth.model.ClientPlatform
import io.streamarr.shared.auth.model.HostedLinkCodeRequest
import io.streamarr.shared.auth.model.HostedLinkCodeResponse
import io.streamarr.shared.auth.model.HostedLinkPollResult
import io.streamarr.shared.auth.remote.HostedDeviceLinkApi
import javax.inject.Inject
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow

/** Coordinates the server-free first contact through playarr.app. */
class HostedDeviceLinkClient @Inject constructor(
    private val api: HostedDeviceLinkApi,
) {
    suspend fun requestCode(clientPlatform: ClientPlatform): HostedLinkCodeResponse =
        api.requestCode(HostedLinkCodeRequest(clientPlatform))

    fun pollUntilResolved(code: HostedLinkCodeResponse): Flow<HostedLinkPollResult> = flow {
        while (true) {
            delay(code.interval * 1000L)
            val result = try {
                val response = api.poll(code.deviceCode)
                when {
                    response.isSuccessful && response.code() == 200 -> response.body()?.claimOrNull()
                        ?.let { HostedLinkPollResult.Approved(it) }
                        ?: HostedLinkPollResult.Failed("Playarr returned an empty link response.")
                    response.code() == 202 -> HostedLinkPollResult.AuthorizationPending
                    response.code() == 404 -> HostedLinkPollResult.Expired
                    else -> HostedLinkPollResult.Failed("Playarr linking returned HTTP ${response.code()}.")
                }
            } catch (error: CancellationException) {
                throw error
            } catch (error: Exception) {
                HostedLinkPollResult.Failed(error.message ?: "Network error while waiting for Playarr linking.")
            }
            emit(result)
            if (result !is HostedLinkPollResult.AuthorizationPending) return@flow
        }
    }
}
