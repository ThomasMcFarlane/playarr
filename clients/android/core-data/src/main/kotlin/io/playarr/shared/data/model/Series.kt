package io.playarr.shared.data.model

import java.time.LocalDate
import kotlinx.serialization.Serializable

/**
 * Kotlin mirror of the `Season`/`Episode` schemas in
 * `backend/openapi/playarr.yaml`. TV works (kind [WorkKind.Series])
 * attach a list of [SeasonDetail] (`season` plus its `episodes`) under
 * `WorkDetailSchema.children` -- see [WorkChildren.Series].
 *
 * There is no standalone `Series` schema in the real spec (unlike the
 * Wave-1 placeholder this replaced, which spoke to a hypothetical
 * `/api/works/{workId}/seasons` endpoint that was never real): a series
 * `Work`'s own fields (title, overview, images, ...) are all a client
 * needs beyond [Season]/[Episode].
 */
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
    /** Episode stills (normally [ImageKind.Thumb]); empty until the source supplies them. */
    val images: List<ImageAsset> = emptyList(),
    @Serializable(with = LocalDateIsoSerializer::class)
    val airDate: LocalDate? = null,
    val runtimeMinutes: Int? = null,
    val monitored: Boolean,
    val availability: Availability,
)
