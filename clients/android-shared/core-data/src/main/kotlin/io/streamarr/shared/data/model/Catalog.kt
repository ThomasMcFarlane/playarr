package io.streamarr.shared.data.model

import kotlinx.serialization.KSerializer
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.descriptors.SerialDescriptor
import kotlinx.serialization.descriptors.buildClassSerialDescriptor
import kotlinx.serialization.encoding.Decoder
import kotlinx.serialization.encoding.Encoder
import kotlinx.serialization.json.JsonDecoder
import kotlinx.serialization.json.JsonEncoder
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject

/** `GET /api/v1/catalog` response body -- mirrors `CatalogPageSchema`. */
@Serializable
data class CatalogPage(
    val items: List<Work>,
    val total: Long? = null,
)

/** `GET /api/v1/catalog/{id}` response body -- mirrors `WorkDetailSchema`. */
@Serializable
data class WorkDetail(
    val work: Work,
    val children: WorkChildren,
)

/** One season plus its episodes -- mirrors `SeasonDetailSchema`. */
@Serializable
data class SeasonDetail(
    val season: Season,
    val episodes: List<Episode>,
)

/** One album plus its tracks -- mirrors `AlbumDetailSchema`. */
@Serializable
data class AlbumDetail(
    val album: Album,
    val tracks: List<Track>,
)

/**
 * Mirrors `WorkChildrenSchema` -- the kind-specific child tree of a
 * [WorkDetail]. On the wire this is serde's default externally-tagged
 * representation for a mixed unit/tuple Rust enum (same shape as
 * [ExternalProvider]): the unit variant [Movie] is a bare JSON string
 * `"Movie"`, and the tuple variants are single-key objects, e.g.
 * `{"Series": [...]}`.
 */
@Serializable(with = WorkChildrenSerializer::class)
sealed interface WorkChildren {
    /** A movie `Work` has no children of its own. */
    data object Movie : WorkChildren
    data class Series(val seasons: List<SeasonDetail>) : WorkChildren
    data class Artist(val albums: List<AlbumDetail>) : WorkChildren
    data class Author(val books: List<Book>) : WorkChildren
}

object WorkChildrenSerializer : KSerializer<WorkChildren> {
    override val descriptor: SerialDescriptor =
        buildClassSerialDescriptor("io.streamarr.shared.data.model.WorkChildren")

    private val seasonDetailListSerializer = ListSerializer(SeasonDetail.serializer())
    private val albumDetailListSerializer = ListSerializer(AlbumDetail.serializer())
    private val bookListSerializer = ListSerializer(Book.serializer())

    override fun serialize(encoder: Encoder, value: WorkChildren) {
        require(encoder is JsonEncoder) { "WorkChildren can only be serialized to JSON" }
        when (value) {
            WorkChildren.Movie -> encoder.encodeJsonElement(JsonPrimitive("Movie"))
            is WorkChildren.Series -> encoder.encodeJsonElement(
                JsonObject(mapOf("Series" to encoder.json.encodeToJsonElement(seasonDetailListSerializer, value.seasons))),
            )
            is WorkChildren.Artist -> encoder.encodeJsonElement(
                JsonObject(mapOf("Artist" to encoder.json.encodeToJsonElement(albumDetailListSerializer, value.albums))),
            )
            is WorkChildren.Author -> encoder.encodeJsonElement(
                JsonObject(mapOf("Author" to encoder.json.encodeToJsonElement(bookListSerializer, value.books))),
            )
        }
    }

    override fun deserialize(decoder: Decoder): WorkChildren {
        require(decoder is JsonDecoder) { "WorkChildren can only be deserialized from JSON" }
        val element = decoder.decodeJsonElement()
        if (element is JsonPrimitive && element.content == "Movie") {
            return WorkChildren.Movie
        }
        val obj = element.jsonObject
        return when {
            "Series" in obj ->
                WorkChildren.Series(decoder.json.decodeFromJsonElement(seasonDetailListSerializer, obj.getValue("Series")))
            "Artist" in obj ->
                WorkChildren.Artist(decoder.json.decodeFromJsonElement(albumDetailListSerializer, obj.getValue("Artist")))
            "Author" in obj ->
                WorkChildren.Author(decoder.json.decodeFromJsonElement(bookListSerializer, obj.getValue("Author")))
            else -> error("Unknown WorkChildren shape: ${obj.keys}")
        }
    }
}
