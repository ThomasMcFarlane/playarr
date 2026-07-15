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
 * Kotlin mirror of `streamarr-model::playback`. Playback analytics: a
 * [PlaybackSession] (one row per play) and a stream of [PlaybackEvent]s
 * (see `PlaybackEvent.kt`) describing what happened during it.
 */
@Serializable
enum class PlayMethod {
    /** Source file served byte-for-byte with no remuxing or transcoding. */
    @SerialName("direct_play") DirectPlay,

    /** Source file remuxed into a different container but not re-encoded. */
    @SerialName("direct_stream") DirectStream,

    /** A [Rendition] (Tdarr-produced or on-demand) is being served instead of the source file. */
    @SerialName("transcode") Transcode,
}

/**
 * Why a session couldn't direct-play/direct-stream and had to fall back to
 * a transcode. Populated only when [PlaybackSession.playMethod] is
 * [PlayMethod.Transcode].
 */
@Serializable(with = TranscodeReasonSerializer::class)
sealed interface TranscodeReason {
    data object ContainerNotSupported : TranscodeReason
    data object VideoCodecNotSupported : TranscodeReason
    data object AudioCodecNotSupported : TranscodeReason
    data object VideoBitrateExceedsLimit : TranscodeReason
    data object ResolutionExceedsLimit : TranscodeReason
    data object SubtitleBurnInRequired : TranscodeReason

    /** Server-side policy override (e.g. bandwidth cap) rather than a client capability gap. */
    data object ServerPolicy : TranscodeReason
    data class Other(val reason: String) : TranscodeReason
}

object TranscodeReasonSerializer : KSerializer<TranscodeReason> {
    override val descriptor: SerialDescriptor =
        buildClassSerialDescriptor("io.streamarr.shared.data.model.TranscodeReason")

    private val unitVariants: Map<String, TranscodeReason> = mapOf(
        "container_not_supported" to TranscodeReason.ContainerNotSupported,
        "video_codec_not_supported" to TranscodeReason.VideoCodecNotSupported,
        "audio_codec_not_supported" to TranscodeReason.AudioCodecNotSupported,
        "video_bitrate_exceeds_limit" to TranscodeReason.VideoBitrateExceedsLimit,
        "resolution_exceeds_limit" to TranscodeReason.ResolutionExceedsLimit,
        "subtitle_burn_in_required" to TranscodeReason.SubtitleBurnInRequired,
        "server_policy" to TranscodeReason.ServerPolicy,
    )

    override fun serialize(encoder: Encoder, value: TranscodeReason) {
        require(encoder is JsonEncoder) { "TranscodeReason can only be serialized to JSON" }
        val element: JsonElement = when (value) {
            is TranscodeReason.Other -> JsonObject(mapOf("other" to JsonPrimitive(value.reason)))
            else -> JsonPrimitive(unitVariants.entries.first { it.value == value }.key)
        }
        encoder.encodeJsonElement(element)
    }

    override fun deserialize(decoder: Decoder): TranscodeReason {
        require(decoder is JsonDecoder) { "TranscodeReason can only be deserialized from JSON" }
        val element = decoder.decodeJsonElement()
        if (element is JsonObject) {
            return TranscodeReason.Other(element.jsonObject.getValue("other").jsonPrimitive.content)
        }
        val name = element.jsonPrimitive.content
        return unitVariants[name] ?: TranscodeReason.Other(name)
    }
}

/** Why a [PlaybackSession] ended. */
@Serializable(with = StopReasonSerializer::class)
sealed interface StopReason {
    data object Completed : StopReason
    data object UserStopped : StopReason
    data object Error : StopReason
    data object DeviceDisconnected : StopReason
    data object SessionRevoked : StopReason
    data object ConcurrentLimitExceeded : StopReason
    data object IdleTimeout : StopReason
    data class Other(val reason: String) : StopReason
}

object StopReasonSerializer : KSerializer<StopReason> {
    override val descriptor: SerialDescriptor =
        buildClassSerialDescriptor("io.streamarr.shared.data.model.StopReason")

    private val unitVariants: Map<String, StopReason> = mapOf(
        "completed" to StopReason.Completed,
        "user_stopped" to StopReason.UserStopped,
        "error" to StopReason.Error,
        "device_disconnected" to StopReason.DeviceDisconnected,
        "session_revoked" to StopReason.SessionRevoked,
        "concurrent_limit_exceeded" to StopReason.ConcurrentLimitExceeded,
        "idle_timeout" to StopReason.IdleTimeout,
    )

    override fun serialize(encoder: Encoder, value: StopReason) {
        require(encoder is JsonEncoder) { "StopReason can only be serialized to JSON" }
        val element: JsonElement = when (value) {
            is StopReason.Other -> JsonObject(mapOf("other" to JsonPrimitive(value.reason)))
            else -> JsonPrimitive(unitVariants.entries.first { it.value == value }.key)
        }
        encoder.encodeJsonElement(element)
    }

    override fun deserialize(decoder: Decoder): StopReason {
        require(decoder is JsonDecoder) { "StopReason can only be deserialized from JSON" }
        val element = decoder.decodeJsonElement()
        if (element is JsonObject) {
            return StopReason.Other(element.jsonObject.getValue("other").jsonPrimitive.content)
        }
        val name = element.jsonPrimitive.content
        return unitVariants[name] ?: StopReason.Other(name)
    }
}

/**
 * One playback attempt from start to finish. Written incrementally on the
 * server: a row is inserted at playback start and updated (`endedAt`,
 * `stopReason`, aggregate buffering counters) as the session progresses.
 */
@Serializable
data class PlaybackSession(
    val id: String,
    val userId: String,
    val deviceId: String,
    val mediaFileId: String,
    /** Set only when [playMethod] is [PlayMethod.Transcode] and a durable [Rendition] served it. */
    val renditionId: String? = null,

    @Serializable(with = InstantIsoSerializer::class)
    val startedAt: Instant,
    @Serializable(with = InstantIsoSerializer::class)
    val endedAt: Instant? = null,

    val playMethod: PlayMethod,
    val transcodeReason: TranscodeReason? = null,

    val sourceCodec: String,
    val sourceContainer: String,
    val sourceBitrate: Long? = null,

    /** The codec/container/bitrate actually delivered to the client; equals the source for DirectPlay. */
    val targetCodec: String,
    val targetContainer: String,
    val targetBitrate: Long? = null,

    val clientPlatform: ClientPlatform,
    val clientVersion: String,
    val ipAddress: String? = null,

    val bytesStreamed: Long,
    val bufferingEvents: Int,
    val bufferingMsTotal: Long,

    val stopReason: StopReason? = null,
)
