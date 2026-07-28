package io.playarr.shared.data.model

import java.time.Instant
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * Kotlin mirror of `playarr-model::work`.
 *
 * The top-level taxonomy Playarr Server understands. Deliberately small and
 * closed: everything else (season, album, book...) is a child of a [Work]
 * rather than a [Work] in its own right, because those children don't have
 * independent lifecycle/monitoring semantics at the top level.
 */
@Serializable
enum class WorkKind {
    @SerialName("movie") Movie,
    @SerialName("series") Series,
    @SerialName("site") Site,
    @SerialName("artist") Artist,
    @SerialName("author") Author,
}

/**
 * Where in the availability pipeline a [Work] (or a leaf under it) is
 * sitting. Mirrors the *arr apps' own state machine
 * (queued/downloading/imported) normalized into one shared enum so client
 * UI doesn't need to know which *arr instance produced it.
 */
@Serializable
enum class Availability {
    /** We have not yet reconciled this entity against any source instance. */
    @SerialName("unknown") Unknown,

    /** Monitored and wanted, but not yet found/grabbed anywhere. */
    @SerialName("pending") Pending,

    /** Grabbed and importing (downloading, post-processing, being moved). */
    @SerialName("processing") Processing,

    /** Some but not all children are available (e.g. 8 of 10 episodes). */
    @SerialName("partially_available") PartiallyAvailable,

    /** Fully available and playable. */
    @SerialName("available") Available,

    /** Previously available, removed from disk (by policy or manually). */
    @SerialName("deleted") Deleted,
}

/**
 * A cross-reference to the identifier a [Work] is known by in an external
 * catalog/metadata provider. `Other` is the escape hatch for providers with
 * no first-class variant yet (mirrors `ExternalProvider::Other(String)`).
 */
@Serializable(with = ExternalProviderSerializer::class)
sealed interface ExternalProvider {
    data object Tmdb : ExternalProvider
    data object Tvdb : ExternalProvider
    data object Imdb : ExternalProvider
    data object MusicBrainzArtist : ExternalProvider
    data object MusicBrainzReleaseGroup : ExternalProvider
    data object Goodreads : ExternalProvider
    data object Isbn : ExternalProvider
    data object Asin : ExternalProvider
    data object Tpdb : ExternalProvider
    data class Other(val name: String) : ExternalProvider
}

@Serializable
data class ExternalRef(
    val provider: ExternalProvider,
    val externalId: String,
)

@Serializable
enum class ImageKind {
    @SerialName("poster") Poster,
    @SerialName("backdrop") Backdrop,
    @SerialName("banner") Banner,
    @SerialName("logo") Logo,
    @SerialName("thumb") Thumb,
}

@Serializable
data class ImageAsset(
    val kind: ImageKind,
    val url: String,
    val width: Int? = null,
    val height: Int? = null,
)

/**
 * The aggregate root for anything in the catalog. A movie is a [Work] of
 * kind [WorkKind.Movie] with no children; a series/artist/author is a
 * [Work] whose children (seasons, albums, books) are fetched separately,
 * keyed by [Work.id].
 */
@Serializable
data class Work(
    val id: String,
    val kind: WorkKind,
    val externalRefs: List<ExternalRef> = emptyList(),
    val title: String,
    /** Normalized sort key, e.g. "Test Film, The" rather than "The Test Film". */
    val sortTitle: String,
    val overview: String? = null,
    val images: List<ImageAsset> = emptyList(),
    val genres: List<String> = emptyList(),
    /** Free-form user/automation tags, distinct from [genres]. */
    val tags: List<String> = emptyList(),
    @Serializable(with = InstantIsoSerializer::class)
    val releaseDate: Instant? = null,
    @Serializable(with = InstantIsoSerializer::class)
    val addedAt: Instant,
    /** Whether Playarr Server should actively track/request missing children of this work. */
    val monitored: Boolean,
    val availability: Availability,
)

/** The wire value this [WorkKind] is filtered/matched by, e.g. in `GET /api/v1/catalog?kind=`. */
fun WorkKind.wireName(): String = when (this) {
    WorkKind.Movie -> "movie"
    WorkKind.Series -> "series"
    WorkKind.Site -> "site"
    WorkKind.Artist -> "artist"
    WorkKind.Author -> "author"
}
