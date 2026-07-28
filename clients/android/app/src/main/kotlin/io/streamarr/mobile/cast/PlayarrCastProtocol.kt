package io.streamarr.mobile.cast

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

/**
 * Kotlin mirror of the cross-platform Playarr Cast protocol (canonical
 * definition: the design doc's TypeScript block, also mirrored by
 * `@streamarr-tv/cast-protocol` and the iOS sender). Field names are kept
 * exactly camelCase to match the wire format -- this channel deliberately
 * does *not* use the snake_case naming Streamarr's HTTP API uses (see
 * [playarrCastJson]'s KDoc) -- so, per the design doc's "Mirror rules",
 * no `@SerialName` is needed on any field name itself, only on the
 * discriminant string values below.
 */
const val PLAYARR_CAST_NAMESPACE: String = "urn:x-cast:app.playarr.cast.v1"
const val PLAYARR_CAST_PROTOCOL_VERSION: Int = 1

/** Message-channel cap; see [encodePlayarrCastMessage]. Manifests, playlists, artwork and subtitle text must never go on this channel. */
private const val PLAYARR_CAST_MAX_MESSAGE_BYTES = 64 * 1024

/**
 * The custom-namespace channel's own JSON codec: camelCase (no naming
 * strategy, unlike `core-data`'s `StreamarrHttpClient.json`), unknown-key
 * tolerant so a receiver/sender pair one protocol version apart doesn't
 * fail parsing the fields they *do* both understand.
 */
internal val playarrCastJson: Json = Json {
    ignoreUnknownKeys = true
    encodeDefaults = true
    explicitNulls = false
}

// ---- Load request (sent as the standard Cast LOAD's MediaInfo.customData,
// NOT on the custom-namespace message channel -- see PlayarrCastSession's
// loadMedia KDoc. Deliberately not part of the PlayarrCastMessage union
// below for exactly that reason.) --------------------------------------

@Serializable
data class PlayarrCastLoadRequest(
    val protocolVersion: Int = PLAYARR_CAST_PROTOCOL_VERSION,
    val server: PlayarrCastServer,
    val credentials: PlayarrCastCredentials,
    val item: PlayarrCastItem,
    val playback: PlayarrCastPlaybackIntent,
    val sender: PlayarrCastSender,
    val queue: List<PlayarrCastQueueEntry>? = null,
)

@Serializable
data class PlayarrCastServer(
    val baseUrl: String,
    val peers: List<PlayarrCastPeer>? = null,
)

@Serializable
data class PlayarrCastPeer(
    val peerNodeId: String,
    val url: String,
)

/**
 * The receiver's OWN delegated device identity -- never the sender's own
 * access/refresh token. See `PlayarrDelegatedDeviceAuth`'s KDoc.
 */
@Serializable
data class PlayarrCastCredentials(
    val deviceId: String,
    val accessToken: String,
    /** Epoch milliseconds. */
    val accessTokenExpiresAt: Long,
    val refreshToken: String,
)

@Serializable
enum class PlayarrCastItemKind {
    @SerialName("movie") Movie,
    @SerialName("episode") Episode,
    @SerialName("track") Track,
    @SerialName("other") Other,
}

@Serializable
data class PlayarrCastItem(
    val mediaFileId: String,
    val workId: String? = null,
    val kind: PlayarrCastItemKind,
    val title: String,
    val subtitle: String? = null,
    val seasonNumber: Int? = null,
    val episodeNumber: Int? = null,
    /** ISO 8601. */
    val releaseDate: String? = null,
    val durationMs: Long? = null,
)

@Serializable
data class PlayarrCastPlaybackIntent(
    /** Absolute source-timeline position, NOT engine time -- see the design doc's Ground Truth notes on source offset vs. engine position. */
    val startPositionMs: Long,
    val autoplay: Boolean,
    val preferredAudioTrackId: String? = null,
    val preferredSubtitleTrackId: String? = null,
    val preferredAudioLanguage: String? = null,
    val preferredSubtitleLanguage: String? = null,
    val qualityId: String? = null,
    val maxBitrateBps: Long? = null,
)

@Serializable
enum class PlayarrCastSenderPlatform {
    @SerialName("web") Web,
    @SerialName("android-mobile") AndroidMobile,
    @SerialName("ios") Ios,
}

@Serializable
data class PlayarrCastSender(
    val platform: PlayarrCastSenderPlatform,
    val appVersion: String,
    val deviceName: String,
    /** BCP-47. */
    val language: String,
)

@Serializable
data class PlayarrCastQueueEntry(
    val mediaFileId: String,
    val workId: String? = null,
    val kind: PlayarrCastItemKind,
    val title: String,
    val subtitle: String? = null,
    val seasonNumber: Int? = null,
    val episodeNumber: Int? = null,
    val durationMs: Long? = null,
)

// ---- Custom-namespace messages (bidirectional, flat "type" discriminator) ----

@Serializable
sealed interface PlayarrCastMessage {
    val protocolVersion: Int
    val requestId: String?
}

@Serializable
sealed interface PlayarrCastSenderMessage : PlayarrCastMessage

@Serializable
sealed interface PlayarrCastReceiverMessage : PlayarrCastMessage

@Serializable
@SerialName("auth.update")
data class PlayarrCastAuthUpdateMessage(
    override val protocolVersion: Int = PLAYARR_CAST_PROTOCOL_VERSION,
    override val requestId: String? = null,
    val credentials: PlayarrCastCredentials,
) : PlayarrCastSenderMessage

@Serializable
@SerialName("tracks.select")
data class PlayarrCastSelectTracksMessage(
    override val protocolVersion: Int = PLAYARR_CAST_PROTOCOL_VERSION,
    override val requestId: String? = null,
    val audioTrackId: String? = null,
    val subtitleTrackId: String? = null,
) : PlayarrCastSenderMessage

@Serializable
@SerialName("quality.select")
data class PlayarrCastSelectQualityMessage(
    override val protocolVersion: Int = PLAYARR_CAST_PROTOCOL_VERSION,
    override val requestId: String? = null,
    val qualityId: String,
) : PlayarrCastSenderMessage

@Serializable
@SerialName("queue.set")
data class PlayarrCastSetQueueMessage(
    override val protocolVersion: Int = PLAYARR_CAST_PROTOCOL_VERSION,
    override val requestId: String? = null,
    val items: List<PlayarrCastQueueEntry>,
) : PlayarrCastSenderMessage

@Serializable
@SerialName("queue.playNext")
data class PlayarrCastPlayNextMessage(
    override val protocolVersion: Int = PLAYARR_CAST_PROTOCOL_VERSION,
    override val requestId: String? = null,
) : PlayarrCastSenderMessage

@Serializable
@SerialName("state.request")
data class PlayarrCastRequestStateMessage(
    override val protocolVersion: Int = PLAYARR_CAST_PROTOCOL_VERSION,
    override val requestId: String? = null,
) : PlayarrCastSenderMessage

@Serializable
enum class PlayarrCastStopReason {
    @SerialName("completed") Completed,
    @SerialName("user_stopped") UserStopped,
    @SerialName("error") Error,
    @SerialName("device_disconnected") DeviceDisconnected,
}

@Serializable
@SerialName("session.end")
data class PlayarrCastEndSessionMessage(
    override val protocolVersion: Int = PLAYARR_CAST_PROTOCOL_VERSION,
    override val requestId: String? = null,
    val reason: PlayarrCastStopReason,
) : PlayarrCastSenderMessage

@Serializable
data class PlayarrCastDeviceCapabilities(
    val supportsH264: Boolean,
    val supportsHevc: Boolean,
    val supportsVp9: Boolean,
    val supportsAv1: Boolean,
    val supports4k: Boolean,
    val supportsHdr: Boolean,
)

@Serializable
@SerialName("ready")
data class PlayarrCastReadyMessage(
    override val protocolVersion: Int = PLAYARR_CAST_PROTOCOL_VERSION,
    override val requestId: String? = null,
    val receiverVersion: String,
    val supportedProtocolVersion: Int,
    val deviceCapabilities: PlayarrCastDeviceCapabilities,
) : PlayarrCastReceiverMessage

@Serializable
data class PlayarrCastTrackOption(
    val id: String,
    val label: String,
    val language: String? = null,
    val forced: Boolean = false,
    val isDefault: Boolean = false,
)

@Serializable
data class PlayarrCastQualityOption(
    val id: String,
    val label: String,
    val height: Int? = null,
    val videoBitrateBps: Long? = null,
)

@Serializable
@SerialName("state")
data class PlayarrCastStateMessage(
    override val protocolVersion: Int = PLAYARR_CAST_PROTOCOL_VERSION,
    override val requestId: String? = null,
    val mediaFileId: String,
    val sessionId: String? = null,
    val negotiating: Boolean = false,
    /** `"direct"` | `"hls"` | `null`. */
    val mode: String? = null,
    val sourceOffsetMs: Long = 0L,
    val positionMs: Long = 0L,
    val durationMs: Long = 0L,
    val audioTracks: List<PlayarrCastTrackOption> = emptyList(),
    val subtitleTracks: List<PlayarrCastTrackOption> = emptyList(),
    val qualityOptions: List<PlayarrCastQualityOption> = emptyList(),
    val selectedAudioTrackId: String? = null,
    val selectedSubtitleTrackId: String? = null,
    val selectedQualityId: String = "original",
    val queue: List<PlayarrCastQueueEntry> = emptyList(),
) : PlayarrCastReceiverMessage

@Serializable
@SerialName("auth.rotated")
data class PlayarrCastAuthRotatedMessage(
    override val protocolVersion: Int = PLAYARR_CAST_PROTOCOL_VERSION,
    override val requestId: String? = null,
    val credentials: PlayarrCastCredentials,
) : PlayarrCastReceiverMessage

@Serializable
enum class PlayarrCastErrorCode {
    @SerialName("unsupported_protocol_version") UnsupportedProtocolVersion,
    @SerialName("invalid_load_request") InvalidLoadRequest,
    @SerialName("server_unreachable") ServerUnreachable,
    @SerialName("insecure_server") InsecureServer,
    @SerialName("auth_failed") AuthFailed,
    @SerialName("negotiation_failed") NegotiationFailed,
    @SerialName("playback_failed") PlaybackFailed,
    @SerialName("session_expired") SessionExpired,
    @SerialName("unknown") Unknown,
}

@Serializable
@SerialName("error")
data class PlayarrCastErrorMessage(
    override val protocolVersion: Int = PLAYARR_CAST_PROTOCOL_VERSION,
    override val requestId: String? = null,
    val code: PlayarrCastErrorCode,
    val message: String,
    val apiStatus: Int? = null,
    val retryable: Boolean = false,
) : PlayarrCastReceiverMessage

@Serializable
@SerialName("ack")
data class PlayarrCastAckMessage(
    override val protocolVersion: Int = PLAYARR_CAST_PROTOCOL_VERSION,
    // Narrower than the envelope's optional requestId -- an ack always
    // names the request it acknowledges. A non-null override of a nullable
    // supertype property is valid Kotlin (String is a subtype of String?).
    override val requestId: String,
    val ok: Boolean,
    val code: PlayarrCastErrorCode? = null,
    val message: String? = null,
) : PlayarrCastReceiverMessage

// ---- Guard / codec functions (design doc's exact exported surface) ----

/** Never throws; validates [raw] against [PlayarrCastLoadRequest]'s shape. */
fun isPlayarrCastLoadRequest(raw: String): Boolean = runCatching {
    playarrCastJson.decodeFromString(PlayarrCastLoadRequest.serializer(), raw)
}.isSuccess

/** Never throws; validates [raw] against the [PlayarrCastSenderMessage] union. */
fun isPlayarrCastSenderMessage(raw: String): Boolean = runCatching {
    playarrCastJson.decodeFromString(PlayarrCastSenderMessage.serializer(), raw)
}.isSuccess

/** Never throws; validates [raw] against the [PlayarrCastReceiverMessage] union. */
fun isPlayarrCastReceiverMessage(raw: String): Boolean = runCatching {
    playarrCastJson.decodeFromString(PlayarrCastReceiverMessage.serializer(), raw)
}.isSuccess

/** Parses [raw] as any [PlayarrCastMessage] (sender or receiver); never throws. */
fun parsePlayarrCastMessage(raw: String): PlayarrCastMessage? = runCatching {
    playarrCastJson.decodeFromString(PlayarrCastMessage.serializer(), raw)
}.getOrNull()

/**
 * Encodes [message] for the custom-namespace channel. Throws
 * [IllegalArgumentException] (Kotlin's closest idiomatic match for the
 * design doc's `RangeError`, which is JS-specific) once past the 64 KB
 * channel cap -- callers must never put manifests, playlists, artwork or
 * subtitle text on this channel; if this throws, that's what happened.
 */
fun encodePlayarrCastMessage(message: PlayarrCastMessage): String {
    val encoded = playarrCastJson.encodeToString(PlayarrCastMessage.serializer(), message)
    val byteSize = encoded.toByteArray(Charsets.UTF_8).size
    require(byteSize <= PLAYARR_CAST_MAX_MESSAGE_BYTES) {
        "Playarr Cast message of $byteSize bytes exceeds the $PLAYARR_CAST_MAX_MESSAGE_BYTES-byte channel cap"
    }
    return encoded
}
