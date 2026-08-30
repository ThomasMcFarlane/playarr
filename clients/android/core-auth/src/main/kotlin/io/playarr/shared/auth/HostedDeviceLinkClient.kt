package io.playarr.shared.auth

import io.playarr.shared.auth.model.ClientPlatform
import io.playarr.shared.auth.model.HostedLinkCodeRequest
import io.playarr.shared.auth.model.HostedLinkCodeResponse
import io.playarr.shared.auth.model.HostedLinkPollResult
import io.playarr.shared.auth.remote.HostedDeviceLinkApi
import javax.inject.Inject
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow

/** Coordinates the server-free first contact through playarr.app. */
class HostedDeviceLinkClient @Inject constructor(
    private val api: HostedDeviceLinkApi,
) {
    private var wait: suspend (Long) -> Unit = { delay(it) }
    private var monotonicTimeMillis: () -> Long = { System.nanoTime() / NANOS_PER_MILLISECOND }

    internal constructor(
        api: HostedDeviceLinkApi,
        wait: suspend (Long) -> Unit,
        monotonicTimeMillis: () -> Long,
    ) : this(api) {
        this.wait = wait
        this.monotonicTimeMillis = monotonicTimeMillis
    }

    suspend fun requestCode(clientPlatform: ClientPlatform): HostedLinkCodeResponse =
        api.requestCode(HostedLinkCodeRequest(clientPlatform))

    fun pollUntilResolved(code: HostedLinkCodeResponse): Flow<HostedLinkPollResult> = flow {
        val lifetimeMillis = code.expiresIn
            .coerceIn(0L, MAX_PAIRING_ATTEMPT_SECONDS)
            .times(MILLISECONDS_PER_SECOND)
        val deadlineMillis = monotonicTimeMillis() + lifetimeMillis
        val pollingIntervalMillis = code.interval
            .coerceAtLeast(MIN_POLLING_INTERVAL_SECONDS)
            .times(MILLISECONDS_PER_SECOND)

        while (true) {
            val remainingMillis = deadlineMillis - monotonicTimeMillis()
            if (remainingMillis <= 0L) {
                emit(HostedLinkPollResult.Expired)
                return@flow
            }
            wait(minOf(pollingIntervalMillis, remainingMillis))
            if (monotonicTimeMillis() >= deadlineMillis) {
                emit(HostedLinkPollResult.Expired)
                return@flow
            }
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

    private companion object {
        const val MIN_POLLING_INTERVAL_SECONDS = 5L
        const val MAX_PAIRING_ATTEMPT_SECONDS = 5L * 60L
        const val MILLISECONDS_PER_SECOND = 1_000L
        const val NANOS_PER_MILLISECOND = 1_000_000L
    }
}
