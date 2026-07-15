package io.streamarr.shared.data.model

import java.time.LocalDate
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * Kotlin mirror of the `Album`/`Track`/`AlbumType` schemas in
 * `backend/openapi/streamarr.yaml`. Music works (kind [WorkKind.Artist])
 * attach a list of [AlbumDetail] (`album` plus its `tracks`) under
 * `WorkDetailSchema.children` -- see [WorkChildren.Artist].
 *
 * There is no standalone `Artist` schema in the real spec (unlike the
 * Wave-1 placeholder this replaced): an artist `Work`'s own fields
 * (title, overview, images, ...) are all a client needs beyond
 * [Album]/[Track].
 */
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
