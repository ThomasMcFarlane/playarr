package io.playarr.shared.data.model

import java.time.Instant
import java.time.LocalDate
import kotlinx.serialization.Serializable

/**
 * Kotlin mirror of the aggregated release calendar schemas in
 * `backend/openapi/playarr.yaml` (`CalendarResponse`, `CalendarEntry`,
 * `CalendarSourceStatus`, `CalendarFeedStatus`, `CalendarFeedCreated`,
 * `AvailabilityLag`).
 *
 * Enum-like fields are kept as raw wire strings and mapped by the helpers
 * below, so an unknown future value degrades one entry instead of failing the
 * whole response decode.
 */
@Serializable
data class CalendarResponse(
    @Serializable(with = LocalDateIsoSerializer::class) val start: LocalDate,
    @Serializable(with = LocalDateIsoSerializer::class) val end: LocalDate,
    val entries: List<CalendarEntry> = emptyList(),
    val sources: List<CalendarSourceStatus> = emptyList(),
)

@Serializable
data class CalendarEntry(
    val id: String,
    val mediaKind: String,
    val releaseType: String,
    val title: String,
    val subtitle: String? = null,
    val seasonNumber: Long? = null,
    val episodeNumber: Long? = null,
    /** UTC calendar day of the release. */
    @Serializable(with = LocalDateIsoSerializer::class) val date: LocalDate,
    /** Exact release instant when the source provides one; null for all-day entries. */
    @Serializable(with = InstantIsoSerializer::class) val releaseAt: Instant? = null,
    val monitored: Boolean = false,
    val hasFile: Boolean = false,
    /** Absolute external artwork URL; never an instance-local path. */
    val posterUrl: String? = null,
    val workId: String? = null,
    val averageLagSeconds: Long? = null,
    val sources: List<CalendarEntrySource> = emptyList(),
    /** Title identity to post unchanged to the request and watchlist endpoints. */
    val snapshot: TitleSnapshot? = null,
    /** What the signed-in user can do with this entry, computed by the server. */
    val actions: List<CalendarAction> = emptyList(),
    /** Episodes folded into this entry when `group=series_day` was requested. */
    val members: List<CalendarGroupMember> = emptyList(),
) {
    /** The server's action of [kind], if it listed one. */
    fun action(kind: String): CalendarAction? = actions.firstOrNull { it.action == kind }

    /** The library work to open: only when the server enabled `open` for this user. */
    val openWorkId: String?
        get() = action(CalendarAction.OPEN)?.takeIf { it.enabled }?.workId?.takeIf(String::isNotBlank)
}

/** One server-computed calendar action; a disabled one carries a [reason] to show instead of hiding it. */
@Serializable
data class CalendarAction(
    val action: String,
    val enabled: Boolean = false,
    val reason: String? = null,
    val workId: String? = null,
    val mediaFileId: String? = null,
    val positionMs: Long? = null,
    /** `watchlist`: already listed. `request`: already requested. */
    val active: Boolean = false,
) {
    companion object {
        const val OPEN = "open"
        const val PLAY = "play"
        const val RESUME = "resume"
        const val REQUEST = "request"
        const val WATCHLIST = "watchlist"
    }
}

@Serializable
data class CalendarGroupMember(
    val id: String,
    val subtitle: String? = null,
    val seasonNumber: Long? = null,
    val episodeNumber: Long? = null,
    val monitored: Boolean = false,
    val hasFile: Boolean = false,
)

@Serializable
data class CalendarEntrySource(
    val sourceInstanceId: String,
    val sourceName: String,
    val sourceKind: String,
    val arrId: Long = 0,
)

@Serializable
data class CalendarSourceStatus(
    val sourceInstanceId: String,
    val name: String,
    val kind: String,
    val status: String,
    val error: String? = null,
    val entryCount: Int = 0,
) {
    val isOk: Boolean get() = status == CALENDAR_SOURCE_OK
}

const val CALENDAR_SOURCE_OK = "ok"

/** The media kinds a calendar entry can have, in filter-chip order. */
enum class CalendarMediaKind(val wire: String) {
    Episode("episode"),
    Movie("movie"),
    Album("album"),
    Book("book"),
    ;

    companion object {
        fun fromWire(value: String): CalendarMediaKind? = entries.firstOrNull { it.wire == value }
    }
}

/** `GET /api/v1/calendar/feed`. */
@Serializable
data class CalendarFeedStatus(
    val active: Boolean = false,
    @Serializable(with = InstantIsoSerializer::class) val createdAt: Instant? = null,
    @Serializable(with = InstantIsoSerializer::class) val lastUsedAt: Instant? = null,
    /** True when the server can return the link again; null on servers that predate this (their POST replaces it). */
    val linkAvailable: Boolean? = null,
)

/** `POST /api/v1/calendar/feed` response. [url] and [token] are secrets and are returned only here. */
@Serializable
data class CalendarFeedCreated(
    val url: String,
    val token: String,
    @Serializable(with = InstantIsoSerializer::class) val createdAt: Instant,
) {
    /** Never include the secret in logs or crash reports. */
    override fun toString(): String = "CalendarFeedCreated(createdAt=$createdAt)"
}

/** `GET /api/v1/catalog/{id}/availability-lag`. */
@Serializable
data class AvailabilityLag(
    val averageSeconds: Long? = null,
    val sampleCount: Int = 0,
    val backfillCount: Int = 0,
    val unknownCount: Int = 0,
    val backfillThresholdDays: Int = 30,
    val averageGrabSeconds: Long? = null,
    val samples: List<AvailabilityLagSample> = emptyList(),
)

@Serializable
data class AvailabilityLagSample(
    @Serializable(with = InstantIsoSerializer::class) val airAt: Instant,
    @Serializable(with = InstantIsoSerializer::class) val importedAt: Instant,
    val lagSeconds: Long,
    val seasonNumber: Long? = null,
    val episodeNumber: Long? = null,
)
