package io.streamarr.shared.data.model

import java.time.Instant
import kotlinx.serialization.KSerializer
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.descriptors.SerialDescriptor
import kotlinx.serialization.descriptors.buildClassSerialDescriptor
import kotlinx.serialization.encoding.Decoder
import kotlinx.serialization.encoding.Encoder
import kotlinx.serialization.json.JsonDecoder
import kotlinx.serialization.json.JsonEncoder
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

/**
 * Kotlin mirror of the `requests` paths in `backend/openapi/streamarr.yaml`:
 * `GET/POST /api/v1/requests`, `POST /api/v1/requests/{id}/approve`,
 * `POST /api/v1/requests/{id}/reject`. No screen in this app calls these
 * yet (see `StreamarrApi`'s KDoc); the types exist so the SDK's coverage
 * of the spec is complete and real, ready for a future requests UI.
 */
@Serializable
enum class RequestStatus {
    @SerialName("pending") Pending,
    @SerialName("approved") Approved,
    @SerialName("rejected") Rejected,
    @SerialName("submitted") Submitted,
    @SerialName("available") Available,
    @SerialName("failed") Failed,
}

/**
 * Mirrors `RequestTargetDto`'s `#[serde(tag = "target_kind")]`
 * internally-tagged representation: the tag and the variant's own field(s)
 * sit in one flat JSON object, e.g. `{"target_kind": "existing_work",
 * "work_id": "..."}` or `{"target_kind": "external", "external_ref": {...}}`.
 */
@Serializable(with = RequestTargetSerializer::class)
sealed interface RequestTarget {
    data class ExistingWork(val workId: String) : RequestTarget
    data class External(val externalRef: ExternalRef) : RequestTarget
}

object RequestTargetSerializer : KSerializer<RequestTarget> {
    override val descriptor: SerialDescriptor =
        buildClassSerialDescriptor("io.streamarr.shared.data.model.RequestTarget")

    override fun serialize(encoder: Encoder, value: RequestTarget) {
        require(encoder is JsonEncoder) { "RequestTarget can only be serialized to JSON" }
        val element = when (value) {
            is RequestTarget.ExistingWork -> JsonObject(
                mapOf(
                    "target_kind" to JsonPrimitive("existing_work"),
                    "work_id" to JsonPrimitive(value.workId),
                ),
            )
            is RequestTarget.External -> JsonObject(
                mapOf(
                    "target_kind" to JsonPrimitive("external"),
                    "external_ref" to encoder.json.encodeToJsonElement(ExternalRef.serializer(), value.externalRef),
                ),
            )
        }
        encoder.encodeJsonElement(element)
    }

    override fun deserialize(decoder: Decoder): RequestTarget {
        require(decoder is JsonDecoder) { "RequestTarget can only be deserialized from JSON" }
        val obj = decoder.decodeJsonElement().jsonObject
        return when (val kind = obj.getValue("target_kind").jsonPrimitive.content) {
            "existing_work" -> RequestTarget.ExistingWork(obj.getValue("work_id").jsonPrimitive.content)
            "external" -> RequestTarget.External(
                decoder.json.decodeFromJsonElement(ExternalRef.serializer(), obj.getValue("external_ref")),
            )
            else -> error("Unknown RequestTarget.target_kind: $kind")
        }
    }
}

/** Mirrors `MediaRequestSchema`. Field names map to snake_case via [io.streamarr.shared.data.remote.StreamarrHttpClient]'s naming strategy. */
@Serializable
data class MediaRequest(
    val id: String,
    val requestedBy: String,
    val kind: WorkKind,
    val target: RequestTarget,
    val status: RequestStatus,
    val sourceInstanceId: String? = null,
    val note: String? = null,
    val decidedBy: String? = null,
    @Serializable(with = InstantIsoSerializer::class)
    val createdAt: Instant,
    @Serializable(with = InstantIsoSerializer::class)
    val updatedAt: Instant,
)

/** Body for `POST /api/v1/requests` -- mirrors `SubmitRequestBody`. */
@Serializable
data class SubmitRequestBody(
    val requestedBy: String,
    val kind: WorkKind,
    val target: RequestTarget,
    val note: String? = null,
)

/** Body for `POST /api/v1/requests/{id}/approve` and `.../reject` -- mirrors `DecideRequestBody`. */
@Serializable
data class DecideRequestBody(
    val decidedBy: String,
    val reason: String? = null,
)
