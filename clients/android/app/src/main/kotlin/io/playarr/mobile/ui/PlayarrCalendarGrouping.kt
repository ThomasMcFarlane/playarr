package io.playarr.mobile.ui

import io.playarr.shared.data.model.CalendarEntry
import io.playarr.shared.data.model.CalendarMediaKind
import java.time.ZoneId

/** One calendar row: a standalone entry, or episodes of one series released together. */
internal sealed interface CalendarItem {
    val key: String
    val first: CalendarEntry
    val title: String

    data class Single(val entry: CalendarEntry) : CalendarItem {
        override val key: String get() = entry.id
        override val first: CalendarEntry get() = entry
        override val title: String get() = entry.title
    }

    data class Series(
        override val key: String,
        override val title: String,
        val entries: List<CalendarEntry>,
        /** Compact episode label, e.g. `S02E04–E06` or `S02E01, E03`. */
        val codes: String,
    ) : CalendarItem {
        override val first: CalendarEntry get() = entries.first()
    }
}

/**
 * Compact label for a set of episodes: contiguous runs inside a season collapse (`S02E04–E06`),
 * gaps are listed (`S02E01, E03, E05`), seasons are comma-joined. Entries without numbers are ignored.
 */
internal fun formatEpisodeCodes(entries: List<CalendarEntry>): String {
    val bySeason = entries.mapNotNull { e ->
        val s = e.seasonNumber ?: return@mapNotNull null
        val n = e.episodeNumber ?: return@mapNotNull null
        s to n
    }.groupBy({ it.first }, { it.second })
    val parts = mutableListOf<String>()
    for (season in bySeason.keys.sorted()) {
        val runs = mutableListOf<LongRange>()
        for (episode in bySeason.getValue(season).distinct().sorted()) {
            val last = runs.lastOrNull()
            if (last != null && episode == last.last + 1) runs[runs.lastIndex] = last.first..episode else runs += episode..episode
        }
        runs.forEachIndexed { index, run ->
            val prefix = if (index == 0) "S${season.toString().padStart(2, '0')}" else ""
            val from = "E${run.first.toString().padStart(2, '0')}"
            parts += if (run.first == run.last) "$prefix$from" else "$prefix$from–E${run.last.toString().padStart(2, '0')}"
        }
    }
    return parts.joinToString(", ")
}

private fun CalendarEntry.timeSlot(zone: ZoneId): String =
    releaseAt?.atZone(zone)?.let { "%02d:%02d".format(it.hour, it.minute) } ?: "all-day"

/**
 * Collapses episodes of the same series released on the same local day and air-time slot into one
 * [CalendarItem.Series]. Movies, albums, books, lone episodes and episodes without numbers stay
 * individual. Pass one day's entries. Same semantics as web `groupSeriesEpisodes`.
 */
internal fun groupSeriesEpisodes(entries: List<CalendarEntry>, zone: ZoneId): List<CalendarItem> {
    val order = LinkedHashMap<String, MutableList<CalendarEntry>>()
    for (entry in entries) {
        val groupable = CalendarMediaKind.fromWire(entry.mediaKind) == CalendarMediaKind.Episode &&
            entry.seasonNumber != null && entry.episodeNumber != null
        val key = if (groupable) {
            "series:${entry.workId ?: entry.title}:${entry.calendarLocalDay(zone)}:${entry.timeSlot(zone)}"
        } else {
            "single:${entry.id}"
        }
        order.getOrPut(key) { mutableListOf() } += entry
    }
    return order.map { (key, members) ->
        if (members.size == 1) {
            CalendarItem.Single(members.first())
        } else {
            val sorted = members.sortedWith(compareBy({ it.seasonNumber ?: 0L }, { it.episodeNumber ?: 0L }, { it.id }))
            CalendarItem.Series(key, sorted.first().title, sorted, formatEpisodeCodes(sorted))
        }
    }
}
