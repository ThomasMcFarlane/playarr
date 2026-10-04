package io.playarr.mobile.remote

import io.playarr.shared.data.model.ApiErrorBody
import io.playarr.shared.data.model.CreateRemoteHandoffRequest
import io.playarr.shared.data.model.CreateRemotePairingRequest
import io.playarr.shared.data.model.RemoteCapability
import io.playarr.shared.data.model.RemoteHandoff
import io.playarr.shared.data.model.RemotePairing
import io.playarr.shared.data.model.RemotePlaybackSnapshot
import io.playarr.shared.data.remote.PlayarrHttpClient
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import retrofit2.HttpException

/** The slice of `PlayarrRemoteApi` the source-side handoff needs (a seam for tests). */
interface RemoteHandoffApi {
    suspend fun createHandoff(request: CreateRemoteHandoffRequest): RemoteHandoff
    /** [waitSeconds] asks the server to hold the call while the handoff is pending. */
    suspend fun getHandoff(id: String, waitSeconds: Int = 0): RemoteHandoff
    suspend fun createPairing(request: CreateRemotePairingRequest): RemotePairing
    suspend fun getPairing(id: String): RemotePairing
}

sealed interface HandoffProgress {
    data object Offering : HandoffProgress
    data class Pairing(val verificationCode: String?) : HandoffProgress
    data object Waiting : HandoffProgress
}

class HandoffFailure(val reason: Reason, message: String) : Exception(message) {
    enum class Reason { Denied, PairingTimeout, Failed, Expired, Rejected }
}

/** The server's machine-readable error code from a failed call, if any. */
internal fun Throwable.apiErrorCode(): String? {
    val body = (this as? HttpException)?.response()?.errorBody()?.string() ?: return null
    return runCatching { PlayarrHttpClient.json.decodeFromString(ApiErrorBody.serializer(), body).error }
        .getOrNull()
        ?.takeIf { it.isNotBlank() }
}

/**
 * Source-side "Play on another device": pair if needed, offer the handoff and
 * wait for the destination's acknowledgement. The server stops this device
 * only after the destination confirms, via a `handoff_stop` event.
 */
suspend fun handOffPlayback(
    api: RemoteHandoffApi,
    sourceDeviceId: String,
    destinationDeviceId: String,
    /** Null when the initiating device is not the source: the server then uses the source's reported state. */
    mediaFileId: String?,
    snapshot: RemotePlaybackSnapshot?,
    controllerName: String,
    requestKey: String,
    onProgress: (HandoffProgress) -> Unit = {},
    pairingTimeoutMs: Long = 5 * 60_000L,
    handoffTimeoutMs: Long = 70_000L,
    pollMs: Long = 1_000L,
    clock: () -> Long = System::currentTimeMillis,
): RemoteHandoff {
    val request = CreateRemoteHandoffRequest(
        requestKey = requestKey,
        sourceDeviceId = sourceDeviceId,
        destinationDeviceId = destinationDeviceId,
        mediaFileId = mediaFileId,
        snapshot = snapshot,
    )
    onProgress(HandoffProgress.Offering)
    var handoff = try {
        api.createHandoff(request)
    } catch (cancel: CancellationException) {
        throw cancel
    } catch (error: Exception) {
        if (error.apiErrorCode() != "pairing_required") {
            throw HandoffFailure(HandoffFailure.Reason.Rejected, error.message ?: "rejected")
        }
        var pairing: RemotePairing? = try {
            api.createPairing(
                CreateRemotePairingRequest(
                    targetDeviceId = destinationDeviceId,
                    scopes = listOf(RemoteCapability.Handoff),
                    controllerName = controllerName,
                ),
            )
        } catch (cancel: CancellationException) {
            throw cancel
        } catch (pairError: Exception) {
            if (pairError.apiErrorCode() != "already_paired") {
                throw HandoffFailure(HandoffFailure.Reason.Rejected, "could not request pairing")
            }
            null
        }
        if (pairing != null) {
            onProgress(HandoffProgress.Pairing(pairing.verificationCode))
            val deadline = clock() + pairingTimeoutMs
            while (pairing!!.status == "pending") {
                if (clock() > deadline) throw HandoffFailure(HandoffFailure.Reason.PairingTimeout, "pairing timed out")
                delay(2_000L)
                pairing = api.getPairing(pairing.id)
            }
            if (pairing.status != "active") {
                throw HandoffFailure(HandoffFailure.Reason.Denied, "pairing was not approved")
            }
        }
        onProgress(HandoffProgress.Offering)
        try {
            api.createHandoff(request)
        } catch (cancel: CancellationException) {
            throw cancel
        } catch (retry: Exception) {
            throw HandoffFailure(HandoffFailure.Reason.Rejected, retry.message ?: "rejected")
        }
    }

    onProgress(HandoffProgress.Waiting)
    val deadline = clock() + handoffTimeoutMs
    while (handoff.status == "pending") {
        if (clock() > deadline) throw HandoffFailure(HandoffFailure.Reason.Expired, "destination did not respond")
        // The server holds the request while pending, so the outcome arrives as soon as the
        // destination acknowledges. A server that ignores `wait` answers at once: poll then.
        val asked = clock()
        handoff = api.getHandoff(handoff.id, 20)
        if (handoff.status == "pending" && clock() - asked < 500L) delay(pollMs)
    }
    return when (handoff.status) {
        "committed" -> handoff
        "expired" -> throw HandoffFailure(HandoffFailure.Reason.Expired, "destination did not respond")
        else -> throw HandoffFailure(
            HandoffFailure.Reason.Failed,
            handoff.failureReason ?: "destination could not play it",
        )
    }
}
