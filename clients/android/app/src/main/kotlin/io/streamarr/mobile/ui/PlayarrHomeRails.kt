package io.streamarr.mobile.ui

import io.streamarr.shared.data.model.WatchProgress
import io.streamarr.shared.data.model.WatchState
import io.streamarr.shared.data.model.Work
import io.streamarr.shared.data.model.WorkKind

internal data class HomeRail(val title: String, val works: List<Work>)

/** Mirrors Playarr Web Home's one primary rail followed by de-duplicated New/More shelves. */
internal fun buildPlayarrHomeRails(
    byKind: Map<WorkKind, List<Work>>,
    progress: List<WatchProgress>,
): List<HomeRail> {
    val movies = byKind[WorkKind.Movie].orEmpty()
    val series = byKind[WorkKind.Series].orEmpty()
    val sites = byKind[WorkKind.Site].orEmpty()
    val supportedWorks = movies + series + sites
    val recent = supportedWorks.sortedByDescending(Work::addedAt)
    val workById = supportedWorks.associateBy(Work::id)
    val onDeck = progress
        .asSequence()
        .filter { it.state == WatchState.PartWatched }
        .sortedByDescending { it.updatedAt.orEmpty() }
        .distinctBy(WatchProgress::workId)
        .mapNotNull { workById[it.workId] }
        .toList()

    val usedIds = mutableSetOf<String>()
    fun takeUnused(source: List<Work>, count: Int): List<Work> = source
        .asSequence()
        .filter { usedIds.add(it.id) }
        .take(count)
        .toList()

    val primary = if (onDeck.isNotEmpty()) takeUnused(onDeck, 10) else takeUnused(recent, 8)
    return listOf(
        HomeRail(if (onDeck.isNotEmpty()) "On deck" else "Start watching", primary),
        HomeRail("New movies", takeUnused(movies, 12)),
        HomeRail("New series", takeUnused(series, 12)),
        HomeRail("New sites", takeUnused(sites, 12)),
        HomeRail("More movies", takeUnused(movies, 12)),
        HomeRail("More series", takeUnused(series, 12)),
        HomeRail("More sites", takeUnused(sites, 12)),
    ).filter { it.works.isNotEmpty() }
}
