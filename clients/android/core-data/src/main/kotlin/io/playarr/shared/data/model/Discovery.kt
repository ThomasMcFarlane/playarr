package io.playarr.shared.data.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * Unified discovery and watchlist wire types
 * (`docs/architecture/discovery-watchlist.md`). Enum-like server fields are
 * kept as strings so a value added by a newer server cannot break decoding;
 * the constants in [DiscoveryWire] name the values this client understands.
 */
object DiscoveryWire {
    const val KIND_GAME = "game"
    const val SOURCE_LIBRARY = "library"
    const val SOURCE_PEER = "peer"
    const val SOURCE_REQUEST = "request"
    const val SOURCE_LIVE_TV = "live_tv"
    const val SOURCE_GAME = "game"
    const val AVAILABILITY_REQUESTABLE = "requestable"
    const val ACTION_PLAY = "play"
    const val ACTION_RESUME = "resume"
    const val ACTION_REQUEST = "request"
    const val ACTION_RECORD = "record"
    const val ACTION_LAUNCH = "launch"
    const val SCOPE_MEDIA = "media"
    const val SCOPE_GAMES = "games"
}

@Serializable
data class TitleSource(
    val source: String,
    val label: String,
    val availability: String,
    val reason: String? = null,
    val edition: String? = null,
    @SerialName("work_id") val workId: String? = null,
    @SerialName("provider_instance_id") val providerInstanceId: String? = null,
)

@Serializable
data class TitleAction(
    val action: String,
    val enabled: Boolean,
    val reason: String? = null,
    @SerialName("work_id") val workId: String? = null,
    @SerialName("media_file_id") val mediaFileId: String? = null,
    @SerialName("position_ms") val positionMs: Long? = null,
    @SerialName("provider_instance_id") val providerInstanceId: String? = null,
)

/** A merged real-world title; `DiscoverTitle` flattens this plus [inWatchlist]. */
@Serializable
data class DiscoveryTitle(
    @SerialName("title_key") val titleKey: String,
    val kind: String,
    val title: String,
    val year: Int? = null,
    @SerialName("external_refs") val externalRefs: List<ExternalRef> = emptyList(),
    @SerialName("poster_url") val posterUrl: String? = null,
    val overview: String? = null,
    val editions: List<String> = emptyList(),
    val sources: List<TitleSource> = emptyList(),
    @SerialName("in_watchlist") val inWatchlist: Boolean = false,
)

@Serializable
data class ProviderStatus(
    val provider: String,
    val state: String,
    val reason: String? = null,
)

@Serializable
data class DiscoverResponse(
    val titles: List<DiscoveryTitle> = emptyList(),
    val providers: List<ProviderStatus> = emptyList(),
)

@Serializable
data class TitleSnapshot(
    val kind: String,
    val title: String,
    val year: Int? = null,
    @SerialName("work_id") val workId: String? = null,
    @SerialName("external_refs") val externalRefs: List<ExternalRef> = emptyList(),
    @SerialName("poster_url") val posterUrl: String? = null,
)

@Serializable
data class ResolvedTitle(
    val title: DiscoveryTitle,
    @SerialName("in_watchlist") val inWatchlist: Boolean,
    val actions: List<TitleAction> = emptyList(),
)

/** `ResolvedTitle` flattened with the time it was added. */
@Serializable
data class WatchlistEntry(
    val title: DiscoveryTitle,
    @SerialName("in_watchlist") val inWatchlist: Boolean = true,
    val actions: List<TitleAction> = emptyList(),
    @SerialName("added_at") val addedAt: String,
)

@Serializable
data class WatchlistResponse(val items: List<WatchlistEntry> = emptyList())

@Serializable
data class RequestResult(
    val status: String,
    @SerialName("provider_instance_id") val providerInstanceId: String,
)
