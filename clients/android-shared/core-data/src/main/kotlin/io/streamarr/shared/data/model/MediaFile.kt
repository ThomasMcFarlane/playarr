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
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonEncoder
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

/**
 * Kotlin mirror of `streamarr-model::media`.
 *
 * Identifies exactly which leaf of a [Work] a [MediaFile] is the source
 * for. A movie's file points straight at the work; a TV/music/book file
 * points at the specific episode/track/book child. Mirrors the Rust
 * adjacently-tagged representation `{"leaf_kind": "...", "leaf_id": "..."}`
 * (content omitted for the unit [LeafRef.OfWork] case).
 */
@Serializable(with = LeafRefSerializer::class)
sealed interface LeafRef {
    /** The file *is* the work (movies). */
    data object OfWork : LeafRef
    data class Episode(val id: String) : LeafRef
    data class Track(val id: String) : LeafRef
    data class Book(val id: String) : LeafRef
}

object LeafRefSerializer : KSerializer<LeafRef> {
    override val descriptor: SerialDescriptor =
        buildClassSerialDescriptor("io.streamarr.shared.data.model.LeafRef")

    override fun serialize(encoder: Encoder, value: LeafRef) {
        require(encoder is JsonEncoder) { "LeafRef can only be serialized to JSON" }
        val element: JsonElement = when (value) {
            LeafRef.OfWork -> JsonObject(mapOf("leaf_kind" to JsonPrimitive("work")))
            is LeafRef.Episode -> JsonObject(
                mapOf("leaf_kind" to JsonPrimitive("episode"), "leaf_id" to JsonPrimitive(value.id)),
            )
            is LeafRef.Track -> JsonObject(
                mapOf("leaf_kind" to JsonPrimitive("track"), "leaf_id" to JsonPrimitive(value.id)),
            )
            is LeafRef.Book -> JsonObject(
                mapOf("leaf_kind" to JsonPrimitive("book"), "leaf_id" to JsonPrimitive(value.id)),
            )
        }
        encoder.encodeJsonElement(element)
    }

    override fun deserialize(decoder: Decoder): LeafRef {
        require(decoder is JsonDecoder) { "LeafRef can only be deserialized from JSON" }
        val obj = decoder.decodeJsonElement().jsonObject
        val kind = obj.getValue("leaf_kind").jsonPrimitive.content
        return when (kind) {
            "work" -> LeafRef.OfWork
            "episode" -> LeafRef.Episode(obj.getValue("leaf_id").jsonPrimitive.content)
            "track" -> LeafRef.Track(obj.getValue("leaf_id").jsonPrimitive.content)
            "book" -> LeafRef.Book(obj.getValue("leaf_id").jsonPrimitive.content)
            else -> error("Unknown LeafRef.leaf_kind: $kind")
        }
    }
}

/**
 * A file on disk as imported by a source *arr instance. The "source of
 * truth" media — encodes derived from it for playback are [Rendition]s,
 * never mutations of the [MediaFile] itself.
 */
@Serializable
data class MediaFile(
    val id: String,
    val workId: String,
    val leafRef: LeafRef,
    /** Server-side filesystem path; opaque to the client, used only for display/debugging. */
    val path: String,
    val container: String,
    val codec: String,
    /** Bits per second; `null` when the source instance didn't report it. */
    val bitrate: Long? = null,
    val sizeBytes: Long,
    /** The *arr instance this file was imported by/discovered through. */
    val sourceInstanceId: String,
    val sourceFileId: String? = null,
)

/** Who produced a [Rendition]: the background Tdarr pipeline, or an on-demand transcode. */
@Serializable
enum class ProducedBy {
    @SerialName("tdarr") Tdarr,
    @SerialName("on_demand") OnDemand,
}

@Serializable
enum class RenditionStatus {
    @SerialName("queued") Queued,
    @SerialName("processing") Processing,
    @SerialName("ready") Ready,
    @SerialName("failed") Failed,

    /** Ready once but past its retention window; needs regenerating before it can serve playback. */
    @SerialName("expired") Expired,
}

/**
 * A playback-ready encode of a [MediaFile], produced either proactively by
 * Tdarr or on-demand. Multiple renditions can exist per `mediaFileId` (one
 * per distinct target profile).
 */
@Serializable
data class Rendition(
    val id: String,
    val mediaFileId: String,
    /** Name of the transcode profile that produced this, e.g. `"h264-1080p-8mbps"`. */
    val profile: String,
    val container: String,
    val codec: String,
    val bitrate: Long? = null,
    val outputPath: String,
    val producedBy: ProducedBy,
    @Serializable(with = InstantIsoSerializer::class)
    val producedAt: Instant,
    val status: RenditionStatus,
)
