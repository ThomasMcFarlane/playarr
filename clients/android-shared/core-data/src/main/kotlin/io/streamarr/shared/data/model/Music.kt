package io.streamarr.shared.data.model

import java.time.LocalDate
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * Kotlin mirror of `streamarr-model::music`. Music: [Artist] detail
 * attached to a [Work] of kind [WorkKind.Artist], with [Album] and [Track]
 * children.
 */
@Serializable
data class Artist(
    val workId: String,
    val disambiguation: String? = null,
)

@Serializable
enum class AlbumType {
    @SerialName("studio") Studio,
    @SerialName("live") Live,
    @SerialName("compilation") Compilation,
    @SerialName("ep") Ep,
    @SerialName("single") Single,
    @SerialName("soundtrack") Soundtrack,
}

@Serializable
data class Album(
    val id: String,
    val artistWorkId: String,
    val title: String,
    val albumType: AlbumType,
    @Serializable(with = LocalDateIsoSerializer::class)
    val releaseDate: LocalDate? = null,
    val monitored: Boolean,
    val availability: Availability,
)

@Serializable
data class Track(
    val id: String,
    val albumId: String,
    val discNumber: Int,
    val trackNumber: Int,
    val title: String,
    val durationSeconds: Int? = null,
    val availability: Availability,
)
