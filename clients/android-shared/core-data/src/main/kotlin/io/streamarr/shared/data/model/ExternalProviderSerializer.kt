package io.streamarr.shared.data.model

import kotlinx.serialization.KSerializer
import kotlinx.serialization.descriptors.SerialDescriptor
import kotlinx.serialization.descriptors.buildClassSerialDescriptor
import kotlinx.serialization.encoding.Decoder
import kotlinx.serialization.encoding.Encoder
import kotlinx.serialization.json.JsonDecoder
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonEncoder
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

/**
 * Mirrors serde's default wire representation of `ExternalProvider` (see
 * `streamarr-model::work`): unit variants encode as a bare snake_case
 * string (`"tmdb"`), and the data-carrying `Other(String)` variant encodes
 * as a single-key object, `{"other": "anidb"}` — serde's default
 * externally-tagged representation for a newtype enum variant.
 */
object ExternalProviderSerializer : KSerializer<ExternalProvider> {
    override val descriptor: SerialDescriptor =
        buildClassSerialDescriptor("io.streamarr.shared.data.model.ExternalProvider")

    override fun serialize(encoder: Encoder, value: ExternalProvider) {
        require(encoder is JsonEncoder) { "ExternalProvider can only be serialized to JSON" }
        val element: JsonElement = when (value) {
            ExternalProvider.Tmdb -> JsonPrimitive("tmdb")
            ExternalProvider.Tvdb -> JsonPrimitive("tvdb")
            ExternalProvider.Imdb -> JsonPrimitive("imdb")
            ExternalProvider.MusicBrainzArtist -> JsonPrimitive("music_brainz_artist")
            ExternalProvider.MusicBrainzReleaseGroup -> JsonPrimitive("music_brainz_release_group")
            ExternalProvider.Goodreads -> JsonPrimitive("goodreads")
            ExternalProvider.Isbn -> JsonPrimitive("isbn")
            ExternalProvider.Asin -> JsonPrimitive("asin")
            is ExternalProvider.Other -> JsonObject(mapOf("other" to JsonPrimitive(value.name)))
        }
        encoder.encodeJsonElement(element)
    }

    override fun deserialize(decoder: Decoder): ExternalProvider {
        require(decoder is JsonDecoder) { "ExternalProvider can only be deserialized from JSON" }
        val element = decoder.decodeJsonElement()
        if (element is JsonObject) {
            return ExternalProvider.Other(element.jsonObject.getValue("other").jsonPrimitive.content)
        }
        return when (val name = element.jsonPrimitive.content) {
            "tmdb" -> ExternalProvider.Tmdb
            "tvdb" -> ExternalProvider.Tvdb
            "imdb" -> ExternalProvider.Imdb
            "music_brainz_artist" -> ExternalProvider.MusicBrainzArtist
            "music_brainz_release_group" -> ExternalProvider.MusicBrainzReleaseGroup
            "goodreads" -> ExternalProvider.Goodreads
            "isbn" -> ExternalProvider.Isbn
            "asin" -> ExternalProvider.Asin
            else -> ExternalProvider.Other(name)
        }
    }
}
