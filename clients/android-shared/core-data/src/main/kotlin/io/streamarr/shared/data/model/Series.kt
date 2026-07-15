package io.streamarr.shared.data.model

import java.time.Instant
import java.time.LocalDate
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * Kotlin mirror of `streamarr-model::series`. TV: [Series] detail attached
 * to a [Work] of kind [WorkKind.Series], with [Season] and [Episode]
 * children.
 */
@Serializable
data class Series(
    val workId: String,
    val network: String? = null,
    val status: SeriesStatus,
    @Serializable(with = InstantIsoSerializer::class)
    val nextAiring: Instant? = null,
)

@Serializable
enum class SeriesStatus {
    @SerialName("upcoming") Upcoming,
    @SerialName("continuing") Continuing,
    @SerialName("ended") Ended,
    @SerialName("cancelled") Cancelled,
}

@Serializable
data class Season(
    val id: String,
    val seriesWorkId: String,
    val seasonNumber: Int,
    val title: String? = null,
    val overview: String? = null,
    val monitored: Boolean,
    val availability: Availability,
)

@Serializable
data class Episode(
    val id: String,
    val seasonId: String,
    val episodeNumber: Int,
    val title: String? = null,
    val overview: String? = null,
    @Serializable(with = LocalDateIsoSerializer::class)
    val airDate: LocalDate? = null,
    val runtimeMinutes: Int? = null,
    val monitored: Boolean,
    val availability: Availability,
)
