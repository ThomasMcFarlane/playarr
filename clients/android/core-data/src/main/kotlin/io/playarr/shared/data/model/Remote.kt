package io.playarr.shared.data.model

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement

/**
 * Kotlin mirror of the `/api/v1/remote endpoints` wire DTOs (phone remote and playback
 * handoff, `docs/architecture/remote-control.md`). Field names are snake_case on
 * the wire via the shared JSON naming strategy.
 */
object RemoteCapability {
    const val Navigate = "navigate"
    const val Text = "text"
    const val Playback = "playback"
    const val Input = "input"
    const val Handoff = "handoff"
}

@Serializable
data class RegisterRemoteTargetRequest(
    val name: String,
    val platform: String? = null,
    val capabilities: List<String>,
)

@Serializable
data class RemoteTarget(
    val deviceId: String,
    val name: String,
    val platform: String,
    val capabilities: List<String>,
    val online: Boolean,
    val isSelf: Boolean,
    val state: JsonElement? = null,
)

@Serializable
data class ReportRemoteStateRequest(val state: JsonElement)

@Serializable
data class CreateRemotePairingRequest(
    val targetDeviceId: String,
    val scopes: List<String>? = null,
    val controllerName: String? = null,
)

@Serializable
data class ApproveRemotePairingRequest(val scopes: List<String>? = null)

@Serializable
data class RemotePairing(
    val id: String,
    /** `pending`, `active`, `denied`, `revoked` or `expired`. */
    val status: String,
    val controllerDeviceId: String,
    val controllerName: String,
    val targetDeviceId: String,
    val scopes: List<String>,
    val verificationCode: String? = null,
    val createdMs: Long,
    val expiresMs: Long,
    val isController: Boolean = false,
    val isTarget: Boolean = false,
)

@Serializable
data class RemoteCommandRequest(
    /** `navigate`, `text`, `playback` or `input`. */
    val kind: String,
    val payload: JsonElement,
)

@Serializable
data class RemoteCommandAccepted(val commandId: String, val seq: Long)

@Serializable
data class RemoteCommandStatus(
    val commandId: String,
    val status: String,
    val detail: String? = null,
)

@Serializable
data class RemoteInboxEvent(
    val id: String,
    val seq: Long,
    /** `pairing_request`, `pairing_revoked`, `command`, `handoff_offer` or `handoff_stop`. */
    val kind: String,
    val pairingId: String? = null,
    val payload: JsonElement? = null,
    val createdMs: Long = 0L,
    val expiresMs: Long = 0L,
)

@Serializable
data class RemoteInbox(val events: List<RemoteInboxEvent> = emptyList(), val next: Long = 0L)

@Serializable
data class AckRemoteEventRequest(val status: String, val detail: String? = null)

@Serializable
data class RemotePlaybackSnapshot(
    val positionMs: Long,
    val durationMs: Long? = null,
    val paused: Boolean = false,
    val audioLanguage: String? = null,
    val subtitleLanguage: String? = null,
)

@Serializable
data class CreateRemoteHandoffRequest(
    val requestKey: String,
    val sourceDeviceId: String,
    val destinationDeviceId: String,
    val mediaFileId: String? = null,
    val snapshot: RemotePlaybackSnapshot? = null,
)

@Serializable
data class AckRemoteHandoffRequest(
    /** `playing` or `failed`. */
    val status: String,
    val positionMs: Long? = null,
    val reason: String? = null,
)

@Serializable
data class RemoteHandoff(
    val id: String,
    /** `pending`, `committed`, `failed`, `expired` or `cancelled`. */
    val status: String,
    val sourceDeviceId: String,
    val destinationDeviceId: String,
    val mediaFileId: String,
    val workId: String,
    val snapshot: RemotePlaybackSnapshot,
    val ackedPositionMs: Long? = null,
    val positionDriftMs: Long? = null,
    val failureReason: String? = null,
    val createdMs: Long = 0L,
    val expiresMs: Long = 0L,
    val completedMs: Long? = null,
)

/** The `{error, message}` body every API error carries. */
@Serializable
data class ApiErrorBody(val error: String = "", val message: String = "")
