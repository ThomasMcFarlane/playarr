package io.playarr.mobile.ui

import io.playarr.shared.data.model.CalendarEntry
import io.playarr.shared.data.model.CalendarMediaKind
import io.playarr.shared.data.model.CalendarSourceStatus
import java.time.DayOfWeek
import java.time.LocalDate
import java.time.ZoneId
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.time.temporal.TemporalAdjusters
import java.time.temporal.WeekFields
import java.util.Locale

/** Pure date-window, grouping and formatting logic for the release calendar (no Android or Compose types). */

internal enum class CalendarViewMode { Agenda, Week, Month }

/** Inclusive range of UTC calendar days requested from the server. */
internal data class CalendarWindow(val start: LocalDate, val end: LocalDate) {
    val days: List<LocalDate> get() = generateSequence(start) { it.plusDays(1) }.takeWhile { !it.isAfter(end) }.toList()
    operator fun contains(day: LocalDate): Boolean = !day.isBefore(start) && !day.isAfter(end)
}

/** Server default is today..today+30; the agenda requests the same 31 days. */
internal const val CALENDAR_AGENDA_SPAN_DAYS = 31L

/** The server rejects spans over 92 days; the widest window here is a six-week month grid (42 days). */
internal const val CALENDAR_MAX_SPAN_DAYS = 92L

internal fun firstDayOfWeek(locale: Locale): DayOfWeek = WeekFields.of(locale).firstDayOfWeek

internal fun calendarWindow(mode: CalendarViewMode, anchor: LocalDate, firstDay: DayOfWeek): CalendarWindow = when (mode) {
    CalendarViewMode.Agenda -> CalendarWindow(anchor, anchor.plusDays(CALENDAR_AGENDA_SPAN_DAYS - 1))
    CalendarViewMode.Week -> {
        val start = anchor.with(TemporalAdjusters.previousOrSame(firstDay))
        CalendarWindow(start, start.plusDays(6))
    }
    CalendarViewMode.Month -> {
        val first = anchor.withDayOfMonth(1)
        val last = anchor.withDayOfMonth(anchor.lengthOfMonth())
        CalendarWindow(
            first.with(TemporalAdjusters.previousOrSame(firstDay)),
            last.with(TemporalAdjusters.nextOrSame(firstDay.minus(1))),
        )
    }
}

/** Moves the anchor one page forward ([direction] > 0) or back ([direction] < 0). */
internal fun shiftCalendarAnchor(mode: CalendarViewMode, anchor: LocalDate, direction: Int): LocalDate {
    val sign = if (direction >= 0) 1L else -1L
    return when (mode) {
        CalendarViewMode.Agenda -> anchor.plusDays(sign * CALENDAR_AGENDA_SPAN_DAYS)
        CalendarViewMode.Week -> anchor.plusWeeks(sign)
        CalendarViewMode.Month -> anchor.withDayOfMonth(1).plusMonths(sign)
    }
}

/** Anchor to use when jumping to [today] in [mode]. */
internal fun todayAnchor(mode: CalendarViewMode, today: LocalDate): LocalDate = when (mode) {
    CalendarViewMode.Month -> today.withDayOfMonth(1)
    else -> today
}

/** Month view keeps its anchor on the first of the month so a day selected in the grid cannot change the page. */
internal fun anchorForMode(mode: CalendarViewMode, anchor: LocalDate): LocalDate = when (mode) {
    CalendarViewMode.Month -> anchor.withDayOfMonth(1)
    else -> anchor
}

internal fun calendarWindowTitle(
    mode: CalendarViewMode,
    anchor: LocalDate,
    window: CalendarWindow,
    locale: Locale,
): String = when (mode) {
    CalendarViewMode.Month -> DateTimeFormatter.ofPattern("LLLL yyyy", locale).format(anchor)
    else -> {
        val formatter = DateTimeFormatter.ofLocalizedDate(FormatStyle.MEDIUM).withLocale(locale)
        "${formatter.format(window.start)} – ${formatter.format(window.end)}"
    }
}

/** Seven-wide rows of days covering [window] (a month grid). */
internal fun calendarGridRows(window: CalendarWindow): List<List<LocalDate>> = window.days.chunked(7)

internal data class CalendarDayGroup(val date: LocalDate, val entries: List<CalendarEntry>)

private val calendarEntryOrder = compareBy<CalendarEntry>(
    { it.releaseAt == null },
    { it.releaseAt },
    { it.title.lowercase() },
    { it.seasonNumber ?: 0L },
    { it.episodeNumber ?: 0L },
)

/** True when [entry] passes the media-kind filter; an empty [kinds] set means "all kinds". */
internal fun CalendarEntry.matches(kinds: Set<CalendarMediaKind>): Boolean =
    kinds.isEmpty() || CalendarMediaKind.fromWire(mediaKind)?.let { it in kinds } ?: true

/**
 * Groups [entries] by their UTC release day. With [fillEmptyDays] every day in [window] gets a
 * group (week view); otherwise only days that have entries do (agenda). Entries outside the
 * window are kept in the agenda so a server that returns a slightly wider range never loses data.
 */
internal fun groupCalendarEntries(
    entries: List<CalendarEntry>,
    kinds: Set<CalendarMediaKind>,
    window: CalendarWindow,
    fillEmptyDays: Boolean,
): List<CalendarDayGroup> {
    val byDay = entries.filter { it.matches(kinds) }.groupBy { it.date }
    val days = if (fillEmptyDays) (window.days + byDay.keys).toSortedSet() else byDay.keys.toSortedSet()
    return days.map { day -> CalendarDayGroup(day, byDay[day].orEmpty().sortedWith(calendarEntryOrder)) }
}

internal fun calendarEntryCountsByDay(entries: List<CalendarEntry>, kinds: Set<CalendarMediaKind>): Map<LocalDate, Int> =
    entries.filter { it.matches(kinds) }.groupingBy { it.date }.eachCount()

internal enum class CalendarLibraryState { InLibrary, Monitored, NotMonitored }

internal fun CalendarEntry.libraryState(): CalendarLibraryState = when {
    hasFile -> CalendarLibraryState.InLibrary
    monitored -> CalendarLibraryState.Monitored
    else -> CalendarLibraryState.NotMonitored
}

/** `S01E02` for episodes that carry both numbers, else null. */
internal fun CalendarEntry.episodeCode(): String? {
    val season = seasonNumber ?: return null
    val episode = episodeNumber ?: return null
    return "S${season.toString().padStart(2, '0')}E${episode.toString().padStart(2, '0')}"
}

/** Sources that did not answer successfully; shown in a banner, never dropped. */
internal fun failedCalendarSources(sources: List<CalendarSourceStatus>): List<CalendarSourceStatus> =
    sources.filterNot(CalendarSourceStatus::isOk)

/** Release instant in the device zone and locale, or null for all-day entries. */
internal fun CalendarEntry.localReleaseTime(zone: ZoneId, locale: Locale): String? =
    releaseAt?.let {
        DateTimeFormatter.ofLocalizedDateTime(FormatStyle.MEDIUM, FormatStyle.SHORT)
            .withLocale(locale)
            .format(ZonedDateTime.ofInstant(it, zone))
    }

internal fun formatCalendarDay(day: LocalDate, locale: Locale): String =
    DateTimeFormatter.ofLocalizedDate(FormatStyle.FULL).withLocale(locale).format(day)

internal fun formatCalendarDayShort(day: LocalDate, locale: Locale): String =
    DateTimeFormatter.ofPattern("EEE d", locale).format(day)

/** Narrow weekday labels in the order the grid starts on. */
internal fun calendarWeekdayLabels(firstDay: DayOfWeek, locale: Locale): List<String> =
    (0 until 7).map { offset ->
        firstDay.plus(offset.toLong()).getDisplayName(java.time.format.TextStyle.SHORT, locale)
    }

/** How an availability lag is presented: whole days from two days up, else whole hours, else minutes. */
internal enum class LagUnit { Days, Hours, Minutes }

internal data class LagDuration(val unit: LagUnit, val count: Long)

internal fun lagDuration(seconds: Long): LagDuration {
    val clamped = seconds.coerceAtLeast(0L)
    val hours = clamped / 3600.0
    return when {
        hours >= 48.0 -> LagDuration(LagUnit.Days, Math.round(hours / 24.0))
        hours >= 1.0 -> LagDuration(LagUnit.Hours, Math.round(hours))
        else -> LagDuration(LagUnit.Minutes, Math.round(clamped / 60.0).coerceAtLeast(1L))
    }
}
