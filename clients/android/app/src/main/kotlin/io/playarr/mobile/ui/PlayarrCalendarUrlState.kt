package io.playarr.mobile.ui

import io.playarr.shared.data.model.CalendarEntry
import io.playarr.shared.data.model.CalendarMediaKind
import java.net.URLDecoder
import java.net.URLEncoder
import java.time.LocalDate
import java.time.ZoneId

/**
 * Everything the release calendar shows is encoded in one query string, mirroring the web client
 * (`?view=agenda&date=2026-10-04&type=tv,movie&status=upcoming&selected=<id>&panel=subscription`),
 * so state survives process death, rotation and deep links identically on every client.
 * Pure Kotlin: no Android or Compose types.
 */
internal enum class CalendarType(val wire: String, val kind: CalendarMediaKind) {
    Tv("tv", CalendarMediaKind.Episode),
    Movie("movie", CalendarMediaKind.Movie),
    Music("music", CalendarMediaKind.Album),
    Book("book", CalendarMediaKind.Book),
    ;

    companion object {
        fun fromKind(kind: CalendarMediaKind): CalendarType = entries.first { it.kind == kind }
    }
}

internal enum class CalendarStatus(val wire: String) { Aired("aired"), Upcoming("upcoming"), Downloaded("downloaded"), Missing("missing") }

internal enum class CalendarPanel(val wire: String) { Filters("filters"), Subscription("subscription") }

internal data class CalendarFilters(
    val types: Set<CalendarType> = emptySet(),
    /** Source instance ids. */
    val sources: Set<String> = emptySet(),
    val statuses: Set<CalendarStatus> = emptySet(),
    val from: LocalDate? = null,
    val to: LocalDate? = null,
    val monitoredOnly: Boolean = false,
) {
    val activeCount: Int
        get() = listOf(types.isNotEmpty(), sources.isNotEmpty(), statuses.isNotEmpty(), from != null || to != null, monitoredOnly)
            .count { it }
}

internal data class CalendarUrlState(
    val view: CalendarViewMode? = null,
    val date: LocalDate? = null,
    val filters: CalendarFilters = CalendarFilters(),
    /** Selected entry id or group key. */
    val selected: String? = null,
    val panel: CalendarPanel? = null,
)

private fun decode(value: String): String = runCatching { URLDecoder.decode(value, "UTF-8") }.getOrDefault(value)

private fun encode(value: String): String = URLEncoder.encode(value, "UTF-8")

private fun parseDay(raw: String?): LocalDate? = raw?.let { runCatching { LocalDate.parse(it) }.getOrNull() }

private fun list(raw: String?): List<String> = raw.orEmpty().split(',').map(String::trim).filter(String::isNotEmpty)

internal fun parseCalendarQuery(query: String): CalendarUrlState {
    val params = query.removePrefix("?").split('&').filter { it.contains('=') }.associate {
        val (key, value) = it.split('=', limit = 2)
        decode(key) to decode(value)
    }
    var from = parseDay(params["from"])
    var to = parseDay(params["to"])
    if (from != null && to != null && from.isAfter(to)) from = to.also { to = from }
    return CalendarUrlState(
        view = CalendarViewMode.entries.firstOrNull { it.name.lowercase() == params["view"] },
        date = parseDay(params["date"]),
        filters = CalendarFilters(
            types = list(params["type"]).mapNotNull { w -> CalendarType.entries.firstOrNull { it.wire == w } }.toSet(),
            sources = list(params["source"]).toSet(),
            statuses = list(params["status"]).mapNotNull { w -> CalendarStatus.entries.firstOrNull { it.wire == w } }.toSet(),
            from = from,
            to = to,
            monitoredOnly = params["monitored"] == "1",
        ),
        selected = params["selected"]?.takeIf(String::isNotEmpty),
        panel = CalendarPanel.entries.firstOrNull { it.wire == params["panel"] },
    )
}

/** Canonical, deterministic query string (stable key and value order); empty values are omitted. */
internal fun CalendarUrlState.toQuery(): String {
    val parts = mutableListOf<String>()
    fun add(key: String, value: String?) {
        if (!value.isNullOrEmpty()) parts += "$key=$value"
    }
    add("view", view?.name?.lowercase())
    add("date", date?.toString())
    add("type", CalendarType.entries.filter { it in filters.types }.joinToString(",") { it.wire }.ifEmpty { null })
    add("source", filters.sources.sorted().joinToString(",") { encode(it).replace("%2C", ",") }.ifEmpty { null })
    add("status", CalendarStatus.entries.filter { it in filters.statuses }.joinToString(",") { it.wire }.ifEmpty { null })
    add("from", filters.from?.toString())
    add("to", filters.to?.toString())
    add("monitored", if (filters.monitoredOnly) "1" else null)
    add("selected", selected?.let(::encode))
    add("panel", panel?.wire)
    return parts.joinToString("&")
}

private fun CalendarEntry.status(status: CalendarStatus, today: LocalDate, zone: ZoneId): Boolean {
    val aired = !calendarLocalDay(zone).isAfter(today)
    return when (status) {
        CalendarStatus.Aired -> aired
        CalendarStatus.Upcoming -> !aired
        CalendarStatus.Downloaded -> hasFile
        CalendarStatus.Missing -> aired && !hasFile
    }
}

/** Local calendar day: the release instant in [zone] when known, else the server's day. */
internal fun CalendarEntry.calendarLocalDay(zone: ZoneId): LocalDate = releaseAt?.atZone(zone)?.toLocalDate() ?: date

/** Values inside one filter are OR-ed, different filters AND-ed (same as web `applyCalendarFilters`). */
internal fun applyCalendarFilters(
    entries: List<CalendarEntry>,
    filters: CalendarFilters,
    today: LocalDate,
    zone: ZoneId,
): List<CalendarEntry> = entries.filter { entry ->
    val kind = CalendarMediaKind.fromWire(entry.mediaKind)
    val day = entry.calendarLocalDay(zone)
    (filters.types.isEmpty() || kind == null || kind in filters.types.map { it.kind }) &&
        (filters.sources.isEmpty() || entry.sources.any { it.sourceInstanceId in filters.sources }) &&
        (filters.statuses.isEmpty() || filters.statuses.any { entry.status(it, today, zone) }) &&
        (!filters.monitoredOnly || entry.monitored) &&
        (filters.from == null || !day.isBefore(filters.from)) &&
        (filters.to == null || !day.isAfter(filters.to))
}

/** First day of [month] in [year]: the date a month/year jump applies (encoded as `date=`). */
internal fun calendarJumpTarget(year: Int, month: Int): LocalDate = LocalDate.of(year, month.coerceIn(1, 12), 1)
