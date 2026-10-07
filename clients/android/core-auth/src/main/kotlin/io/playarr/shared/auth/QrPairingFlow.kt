package io.playarr.shared.auth

import io.playarr.shared.auth.model.ClientPlatform
import io.playarr.shared.auth.model.DevicePollResult
import io.playarr.shared.auth.model.HostedLinkClaim
import io.playarr.shared.auth.model.HostedLinkCodeResponse
import io.playarr.shared.auth.model.HostedLinkPollResult
import io.playarr.shared.auth.model.TokenResponse
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow

/** What the QR sign-in screen should currently show. */
sealed interface QrPairingUpdate {
    /** Asking playarr.app for a (fresh) code; show the spinner, never an error. */
    data object Requesting : QrPairingUpdate

    /** Show this QR and pairing code. Also emitted again for each renewed code. */
    data class ShowCode(val code: HostedLinkCodeResponse) : QrPairingUpdate

    /** Pairing finished; terminal. */
    data class Linked(val claim: HostedLinkClaim, val token: TokenResponse) : QrPairingUpdate

    /** The user explicitly declined on the other device; terminal. */
    data object Declined : QrPairingUpdate
}

/**
 * Self-renewing QR / device-code sign-in, matching the web client's `DeviceLogin`.
 *
 * An expired hosted code, an expired server device code (`expired_token`, the
 * "session expired" state) and any transient failure (network blip, HTTP 5xx)
 * silently request a fresh code and show a new QR, with no error and no user
 * action. Polling continues until the user approves ([QrPairingUpdate.Linked]),
 * explicitly declines ([QrPairingUpdate.Declined]) or the collector is
 * cancelled. Only the playarr.app link is used, so no server URL is ever asked
 * for; the pairing flow delivers the server address in the claim.
 *
 * Transient failures retry with exponential backoff (2 s doubling to 30 s,
 * reset by every success). The same code keeps being polled through a blip for
 * as long as it is valid.
 */
class QrPairingFlow internal constructor(
    private val requestCode: suspend () -> HostedLinkCodeResponse,
    private val pollHosted: (HostedLinkCodeResponse) -> Flow<HostedLinkPollResult>,
    private val prepareServer: suspend (HostedLinkClaim) -> Unit,
    private val pollServer: (String) -> Flow<DevicePollResult>,
    private val wait: suspend (Long) -> Unit = { delay(it) },
    private val monotonicTimeMillis: () -> Long = { System.nanoTime() / NANOS_PER_MILLISECOND },
) {
    constructor(
        hosted: HostedDeviceLinkClient,
        device: DeviceAuthClient,
        clientPlatform: ClientPlatform,
        prepareServer: suspend (HostedLinkClaim) -> Unit,
    ) : this(
        requestCode = { hosted.requestCode(clientPlatform) },
        pollHosted = hosted::pollUntilResolved,
        prepareServer = prepareServer,
        pollServer = { device.pollUntilResolved(it, SERVER_POLL_INTERVAL_SECONDS) },
    )

    fun run(): Flow<QrPairingUpdate> = flow {
        val backoff = Backoff()
        while (true) {
            emit(QrPairingUpdate.Requesting)
            val code = try {
                requestCode()
            } catch (error: CancellationException) {
                throw error
            } catch (_: Exception) {
                wait(backoff.next())
                continue
            }
            backoff.reset()
            emit(QrPairingUpdate.ShowCode(code))
            val claim = awaitClaim(code, backoff) ?: continue
            val outcome = redeem(claim, backoff) ?: continue
            emit(outcome)
            return@flow
        }
    }

    /** Waits for the phone-side approval; null means the code ran out and a new one is needed. */
    private suspend fun awaitClaim(code: HostedLinkCodeResponse, backoff: Backoff): HostedLinkClaim? {
        val lifetimeMillis = code.expiresIn.coerceIn(0L, MAX_ATTEMPT_SECONDS) * MILLIS_PER_SECOND
        val deadline = monotonicTimeMillis() + lifetimeMillis
        while (true) {
            val remaining = deadline - monotonicTimeMillis()
            if (remaining <= 0L) return null
            var claim: HostedLinkClaim? = null
            var expired = false
            val remainingSeconds = (remaining + MILLIS_PER_SECOND - 1) / MILLIS_PER_SECOND
            safeCollect(pollHosted(code.copy(expiresIn = remainingSeconds))) { result ->
                when (result) {
                    is HostedLinkPollResult.Approved -> claim = result.claim
                    HostedLinkPollResult.Expired -> expired = true
                    HostedLinkPollResult.AuthorizationPending -> backoff.reset()
                    is HostedLinkPollResult.Failed -> Unit
                }
            }
            claim?.let { return it }
            if (expired) return null
            wait(backoff.next())
        }
    }

    /** Exchanges the claim for a token; null means the server code expired and pairing restarts. */
    private suspend fun redeem(claim: HostedLinkClaim, backoff: Backoff): QrPairingUpdate? {
        val deadline = monotonicTimeMillis() + MAX_ATTEMPT_SECONDS * MILLIS_PER_SECOND
        while (monotonicTimeMillis() < deadline) {
            try {
                prepareServer(claim)
            } catch (error: CancellationException) {
                throw error
            } catch (_: Exception) {
                wait(backoff.next())
                continue
            }
            var outcome: QrPairingUpdate? = null
            var expired = false
            safeCollect(pollServer(claim.serverDeviceCode)) { result ->
                when (result) {
                    is DevicePollResult.Approved -> outcome = QrPairingUpdate.Linked(claim, result.token)
                    DevicePollResult.Denied -> outcome = QrPairingUpdate.Declined
                    DevicePollResult.Expired -> expired = true
                    DevicePollResult.AuthorizationPending, DevicePollResult.SlowDown -> backoff.reset()
                    is DevicePollResult.Failed -> Unit
                }
            }
            outcome?.let { return it }
            if (expired) return null
            wait(backoff.next())
        }
        return null
    }

    private suspend fun <T> safeCollect(source: Flow<T>, onEach: (T) -> Unit) {
        try {
            source.collect { onEach(it) }
        } catch (error: CancellationException) {
            throw error
        } catch (_: Exception) {
            // Treated like a Failed poll: the caller backs off and retries.
        }
    }

    private class Backoff {
        private var attempt = 0
        fun next(): Long {
            val millis = (INITIAL_BACKOFF_MILLIS shl attempt.coerceAtMost(MAX_SHIFT)).coerceAtMost(MAX_BACKOFF_MILLIS)
            attempt += 1
            return millis
        }
        fun reset() {
            attempt = 0
        }
    }

    internal companion object {
        const val SERVER_POLL_INTERVAL_SECONDS = 1L
        const val MAX_ATTEMPT_SECONDS = 5L * 60L
        const val MILLIS_PER_SECOND = 1_000L
        const val NANOS_PER_MILLISECOND = 1_000_000L
        const val INITIAL_BACKOFF_MILLIS = 2_000L
        const val MAX_BACKOFF_MILLIS = 30_000L
        const val MAX_SHIFT = 5
    }
}
