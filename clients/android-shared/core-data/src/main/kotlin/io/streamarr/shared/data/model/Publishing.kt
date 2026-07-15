package io.streamarr.shared.data.model

import java.time.LocalDate
import kotlinx.serialization.Serializable

/**
 * Kotlin mirror of the `Book` schema in `backend/openapi/streamarr.yaml`.
 * Book works (kind [WorkKind.Author]) attach a bare list of [Book] under
 * `WorkDetailSchema.children` -- see [WorkChildren.Author]. There is no
 * standalone `Author` schema in the real spec (unlike the Wave-1
 * placeholder this replaced): an author `Work`'s own fields (title,
 * overview, images, ...) are all a client needs beyond [Book].
 */
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
