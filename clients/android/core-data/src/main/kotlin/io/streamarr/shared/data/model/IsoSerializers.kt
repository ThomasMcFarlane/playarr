package io.streamarr.shared.data.model

import java.time.Instant
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import kotlinx.serialization.KSerializer
import kotlinx.serialization.descriptors.PrimitiveKind
import kotlinx.serialization.descriptors.PrimitiveSerialDescriptor
import kotlinx.serialization.descriptors.SerialDescriptor
import kotlinx.serialization.encoding.Decoder
import kotlinx.serialization.encoding.Encoder

/**
 * Wire format for every `chrono::DateTime<Utc>` field on the server side
 * (see `streamarr-model`): an RFC 3339 / ISO-8601 instant such as
 * `"2026-07-15T09:41:00Z"`. `java.time.Instant` is used on the client
 * (rather than pulling in kotlinx-datetime) because it has been available
 * natively since API 26, which is already this project's `minSdk` floor.
 */
object InstantIsoSerializer : KSerializer<Instant> {
    override val descriptor: SerialDescriptor =
        PrimitiveSerialDescriptor("io.streamarr.shared.data.model.Instant", PrimitiveKind.STRING)

    override fun serialize(encoder: Encoder, value: Instant) {
        encoder.encodeString(DateTimeFormatter.ISO_INSTANT.format(value))
    }

    override fun deserialize(decoder: Decoder): Instant =
        Instant.parse(decoder.decodeString())
}

/**
 * Wire format for every `chrono::NaiveDate` field on the server side (e.g.
 * `Episode::air_date`, `Book::release_date`): a plain calendar date with no
 * time/zone component, `"2026-07-15"`.
 */
object LocalDateIsoSerializer : KSerializer<LocalDate> {
    override val descriptor: SerialDescriptor =
        PrimitiveSerialDescriptor("io.streamarr.shared.data.model.LocalDate", PrimitiveKind.STRING)

    override fun serialize(encoder: Encoder, value: LocalDate) {
        encoder.encodeString(DateTimeFormatter.ISO_LOCAL_DATE.format(value))
    }

    override fun deserialize(decoder: Decoder): LocalDate =
        LocalDate.parse(decoder.decodeString())
}
