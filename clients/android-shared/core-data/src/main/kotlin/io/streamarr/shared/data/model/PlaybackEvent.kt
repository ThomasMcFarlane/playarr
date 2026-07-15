package io.streamarr.shared.data.model

import java.time.Instant
import java.time.format.DateTimeFormatter
import kotlinx.serialization.KSerializer
import kotlinx.serialization.Serializable
import kotlinx.serialization.descriptors.SerialDescriptor
import kotlinx.serialization.descriptors.buildClassSerialDescriptor
import kotlinx.serialization.encoding.Decoder
import kotlinx.serialization.encoding.Encoder
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonDecoder
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonEncoder
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import kotlinx.serialization.json.longOrNull

/**
 * A single timestamped occurrence within a [PlaybackSession]. Kept as a
 * closed hierarchy (mirroring `streamarr-model::playback::PlaybackEventKind`,
 * an internally-tagged Rust enum: `#[serde(tag = "kind")]`) rather than a
 * generic `{kind: String, payload: ...}` bag, so client-side analytics/UI
 * code can exhaustively `when` over every event type the server can emit.
 */
sealed interface PlaybackEventKind {
    data object Start : PlaybackEventKind
    data class Pause(val positionMs: Long) : PlaybackEventKind
    data class Resume(val positionMs: Long) : PlaybackEventKind
    data class Seek(val fromMs: Long, val toMs: Long) : PlaybackEventKind
    data class BufferStart(val positionMs: Long) : PlaybackEventKind
    data class BufferEnd(val durationMs: Long) : PlaybackEventKind
    data class BitrateChange(val fromBps: Long?, val toBps: Long) : PlaybackEventKind
    data class Heartbeat(val positionMs: Long) : PlaybackEventKind
    data class Stop(val reason: StopReason, val positionMs: Long) : PlaybackEventKind
    data class Error(val message: String) : PlaybackEventKind
}

/**
 * Wraps a [PlaybackEventKind] together with envelope fields. On the wire
 * this mirrors `#[serde(flatten)]`: `kind`'s own `"kind"` tag and fields
 * sit alongside `id`/`sessionId`/`occurredAt` in one flat JSON object
 * rather than a nested `"kind": {...}` sub-object, which is why
 * [PlaybackEvent] carries a hand-written serializer instead of a derived
 * one.
 */
@Serializable(with = PlaybackEventSerializer::class)
data class PlaybackEvent(
    val id: String,
    val sessionId: String,
    val occurredAt: Instant,
    val kind: PlaybackEventKind,
)

object PlaybackEventSerializer : KSerializer<PlaybackEvent> {
    override val descriptor: SerialDescriptor =
        buildClassSerialDescriptor("io.streamarr.shared.data.model.PlaybackEvent")

    override fun serialize(encoder: Encoder, value: PlaybackEvent) {
        require(encoder is JsonEncoder) { "PlaybackEvent can only be serialized to JSON" }
        val fields = buildMap<String, JsonElement> {
            put("id", JsonPrimitive(value.id))
            put("session_id", JsonPrimitive(value.sessionId))
            put("occurred_at", JsonPrimitive(DateTimeFormatter.ISO_INSTANT.format(value.occurredAt)))
            putAll(kindToJsonFields(value.kind, encoder.json))
        }
        encoder.encodeJsonElement(JsonObject(fields))
    }

    override fun deserialize(decoder: Decoder): PlaybackEvent {
        require(decoder is JsonDecoder) { "PlaybackEvent can only be deserialized from JSON" }
        val obj = decoder.decodeJsonElement() as JsonObject
        return PlaybackEvent(
            id = obj.getValue("id").jsonPrimitive.content,
            sessionId = obj.getValue("session_id").jsonPrimitive.content,
            occurredAt = Instant.parse(obj.getValue("occurred_at").jsonPrimitive.content),
            kind = kindFromJsonObject(obj, decoder.json),
        )
    }

    /** Builds the `"kind"` tag plus this variant's own fields, to be merged into the parent object. */
    private fun kindToJsonFields(kind: PlaybackEventKind, json: Json): Map<String, JsonElement> = when (kind) {
        PlaybackEventKind.Start -> mapOf("kind" to JsonPrimitive("start"))
        is PlaybackEventKind.Pause -> mapOf(
            "kind" to JsonPrimitive("pause"),
            "position_ms" to JsonPrimitive(kind.positionMs),
        )
        is PlaybackEventKind.Resume -> mapOf(
            "kind" to JsonPrimitive("resume"),
            "position_ms" to JsonPrimitive(kind.positionMs),
        )
        is PlaybackEventKind.Seek -> mapOf(
            "kind" to JsonPrimitive("seek"),
            "from_ms" to JsonPrimitive(kind.fromMs),
            "to_ms" to JsonPrimitive(kind.toMs),
        )
        is PlaybackEventKind.BufferStart -> mapOf(
            "kind" to JsonPrimitive("buffer_start"),
            "position_ms" to JsonPrimitive(kind.positionMs),
        )
        is PlaybackEventKind.BufferEnd -> mapOf(
            "kind" to JsonPrimitive("buffer_end"),
            "duration_ms" to JsonPrimitive(kind.durationMs),
        )
        is PlaybackEventKind.BitrateChange -> mapOf(
            "kind" to JsonPrimitive("bitrate_change"),
            "from_bps" to (kind.fromBps?.let { JsonPrimitive(it) } ?: JsonNull),
            "to_bps" to JsonPrimitive(kind.toBps),
        )
        is PlaybackEventKind.Heartbeat -> mapOf(
            "kind" to JsonPrimitive("heartbeat"),
            "position_ms" to JsonPrimitive(kind.positionMs),
        )
        is PlaybackEventKind.Stop -> mapOf(
            "kind" to JsonPrimitive("stop"),
            "reason" to json.encodeToJsonElement(StopReasonSerializer, kind.reason),
            "position_ms" to JsonPrimitive(kind.positionMs),
        )
        is PlaybackEventKind.Error -> mapOf("kind" to JsonPrimitive("error"), "message" to JsonPrimitive(kind.message))
    }

    /** Reconstructs a [PlaybackEventKind] from an object already known to contain a `"kind"` tag. */
    private fun kindFromJsonObject(obj: JsonObject, json: Json): PlaybackEventKind {
        return when (val kind = obj.getValue("kind").jsonPrimitive.content) {
            "start" -> PlaybackEventKind.Start
            "pause" -> PlaybackEventKind.Pause(obj.getValue("position_ms").jsonPrimitive.long)
            "resume" -> PlaybackEventKind.Resume(obj.getValue("position_ms").jsonPrimitive.long)
            "seek" -> PlaybackEventKind.Seek(
                fromMs = obj.getValue("from_ms").jsonPrimitive.long,
                toMs = obj.getValue("to_ms").jsonPrimitive.long,
            )
            "buffer_start" -> PlaybackEventKind.BufferStart(obj.getValue("position_ms").jsonPrimitive.long)
            "buffer_end" -> PlaybackEventKind.BufferEnd(obj.getValue("duration_ms").jsonPrimitive.long)
            "bitrate_change" -> PlaybackEventKind.BitrateChange(
                fromBps = obj["from_bps"]?.jsonPrimitive?.longOrNull,
                toBps = obj.getValue("to_bps").jsonPrimitive.long,
            )
            "heartbeat" -> PlaybackEventKind.Heartbeat(obj.getValue("position_ms").jsonPrimitive.long)
            "stop" -> PlaybackEventKind.Stop(
                reason = json.decodeFromJsonElement(StopReasonSerializer, obj.getValue("reason")),
                positionMs = obj.getValue("position_ms").jsonPrimitive.long,
            )
            "error" -> PlaybackEventKind.Error(obj.getValue("message").jsonPrimitive.content)
            else -> error("Unknown PlaybackEventKind.kind: $kind")
        }
    }
}
