package io.streamarr.shared.data.model

import java.time.LocalDate
import kotlinx.serialization.Serializable

/**
 * Kotlin mirror of `streamarr-model::publishing`. Books: [Author] detail
 * attached to a [Work] of kind [WorkKind.Author], with [Book] children.
 */
@Serializable
data class Author(
    val workId: String,
)

@Serializable
data class Book(
    val id: String,
    val authorWorkId: String,
    val title: String,
    val isbn: String? = null,
    @Serializable(with = LocalDateIsoSerializer::class)
    val releaseDate: LocalDate? = null,
    val seriesName: String? = null,
    val seriesPosition: Float? = null,
    val monitored: Boolean,
    val availability: Availability,
)
