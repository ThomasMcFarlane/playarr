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
        "yMd" -> java.time.format.DateTimeFormatter.ofLocalizedDate(java.time.format.FormatStyle.SHORT)
        "yMdjms" -> java.time.format.DateTimeFormatter.ofLocalizedDateTime(java.time.format.FormatStyle.SHORT, java.time.format.FormatStyle.MEDIUM)
        "jms" -> java.time.format.DateTimeFormatter.ofLocalizedTime(java.time.format.FormatStyle.MEDIUM)
        "jm" -> java.time.format.DateTimeFormatter.ofLocalizedTime(java.time.format.FormatStyle.SHORT)
        else -> java.time.format.DateTimeFormatter.ofLocalizedDate(java.time.format.FormatStyle.MEDIUM)
    }.withLocale(locale)
}

/** Web `formatRangeLabel`: "7 Oct – 5 Nov 2026" (short day and month, then the dated end), plain spaces around the dash. */
internal fun playarrRangeLabel(start: LocalDate, end: LocalDate, locale: Locale): String =
    "${PlayarrDateFormat("MMMd", locale).format(start)} – ${PlayarrDateFormat("yMMMd", locale).format(end)}"

/** `{ day: numeric, month: short, year: numeric }`: detail pages, resume options, downloads. */
internal fun playarrShortDate(locale: Locale) = PlayarrDateFormat("yMMMd", locale)

/**
 * Web `Intl.DateTimeFormat(locale, { dateStyle: "full", timeStyle: "short" })`: "Saturday, 10 October 2026 at 01:00" in en-GB.
 * The web's CLDR 46 writes the comma after the weekday for en-GB; the device's older data drops it, so it is restored here.
 */
internal fun playarrFullDateTime(instant: Instant, zone: ZoneId, locale: Locale): String {
    val text = runCatching {
        DateFormat.getDateTimeInstance(DateFormat.FULL, DateFormat.SHORT, locale).also { it.timeZone = TimeZone.getTimeZone(zone.id) }
            .format(Date.from(instant))
    }.getOrElse {
        java.time.format.DateTimeFormatter.ofLocalizedDateTime(java.time.format.FormatStyle.FULL, java.time.format.FormatStyle.SHORT)
            .withLocale(locale).format(ZonedDateTime.ofInstant(instant, zone))
    }
    return if (locale.language == "en" && locale.country == "GB") text.replaceFirst(Regex("^(\\p{L}+) (\\d)"), "$1, $2") else text
}

/** Web `toLocaleString()`, `toLocaleDateString()`, `toLocaleTimeString()` and `{ timeStyle: "short" }`, in the app language. */
internal fun playarrLocaleDateTime(instant: Instant, zone: ZoneId, locale: Locale) = PlayarrDateFormat("yMdjms", locale, zone).format(instant)
internal fun playarrLocaleDate(epochMillis: Long, zone: ZoneId, locale: Locale) = PlayarrDateFormat("yMd", locale, zone).format(epochMillis)
internal fun playarrLocaleTime(instant: Instant, zone: ZoneId, locale: Locale) = PlayarrDateFormat("jms", locale, zone).format(instant)
internal fun playarrShortTime(instant: Instant, zone: ZoneId, locale: Locale) = PlayarrDateFormat("jm", locale, zone).format(instant)
