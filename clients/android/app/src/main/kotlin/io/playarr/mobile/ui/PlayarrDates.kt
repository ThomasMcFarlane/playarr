package io.playarr.mobile.ui

import android.icu.text.DateFormat
import android.icu.util.TimeZone
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.ZoneOffset
import java.time.ZonedDateTime
import java.time.temporal.TemporalAccessor
import java.util.Date
import java.util.Locale

/**
 * Locale-aware dates the way the web's `Intl.DateTimeFormat` writes them: the same CLDR skeletons (day numeric,
 * month short, year numeric and so on), so "7 Oct 2026" in en-GB and "Oct 7, 2026" in en-US, never a hard-coded
 * pattern. Calendar days are formatted in UTC (they carry no zone); instants in [zone].
 */
internal class PlayarrDateFormat(private val skeleton: String, private val locale: Locale, private val zone: ZoneId = ZoneId.systemDefault()) {
    // android.icu is missing from plain JVM unit tests; java.time then stands in with the nearest standard pattern.
    private val utc: DateFormat? = runCatching {
        DateFormat.getInstanceForSkeleton(skeleton, locale).also { it.timeZone = TimeZone.getTimeZone("UTC") }
    }.getOrNull()
    private val local: DateFormat? = runCatching {
        DateFormat.getInstanceForSkeleton(skeleton, locale).also { it.timeZone = TimeZone.getTimeZone(zone.id) }
    }.getOrNull()

    fun format(day: LocalDate): String =
        utc?.format(Date.from(day.atStartOfDay(ZoneOffset.UTC).toInstant())) ?: fallback().format(day)

    fun format(instant: Instant): String =
        local?.format(Date.from(instant)) ?: fallback().withZone(zone).format(instant)

    /** Epoch milliseconds in the formatter's zone. */
    fun format(epochMillis: Long): String = format(Instant.ofEpochMilli(epochMillis))

    fun format(time: TemporalAccessor): String = when (time) {
        is LocalDate -> format(time)
        is Instant -> format(time)
        is ZonedDateTime -> format(time.toInstant())
        else -> format(LocalDate.from(time))
    }

    private fun fallback(): java.time.format.DateTimeFormatter = when (skeleton) {
        "yMMMd" -> java.time.format.DateTimeFormatter.ofLocalizedDate(java.time.format.FormatStyle.MEDIUM)
        "yMMMMEEEEd" -> java.time.format.DateTimeFormatter.ofLocalizedDate(java.time.format.FormatStyle.FULL)
        "yMMMM" -> java.time.format.DateTimeFormatter.ofPattern("LLLL yyyy")
        "MMMd" -> java.time.format.DateTimeFormatter.ofPattern("d MMM")
        "MMMMEEEEd" -> java.time.format.DateTimeFormatter.ofPattern("EEEE d MMMM")
        "MMMMEEEd" -> java.time.format.DateTimeFormatter.ofPattern("EEE d MMMM")
        "EEEd" -> java.time.format.DateTimeFormatter.ofPattern("EEE d")
        else -> java.time.format.DateTimeFormatter.ofLocalizedDate(java.time.format.FormatStyle.MEDIUM)
    }.withLocale(locale)
}

/** Web `formatRangeLabel`: "7 Oct – 5 Nov 2026" (short day and month, then the dated end), plain spaces around the dash. */
internal fun playarrRangeLabel(start: LocalDate, end: LocalDate, locale: Locale): String =
    "${PlayarrDateFormat("MMMd", locale).format(start)} – ${PlayarrDateFormat("yMMMd", locale).format(end)}"

/** `{ day: numeric, month: short, year: numeric }`: detail pages, resume options, downloads. */
internal fun playarrShortDate(locale: Locale) = PlayarrDateFormat("yMMMd", locale)
