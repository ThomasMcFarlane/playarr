package io.playarr.mobile.ui

import io.playarr.shared.data.model.ResumePlan
import io.playarr.shared.data.model.HomeRailDto
import io.playarr.shared.data.model.RailPreferenceEntry
import io.playarr.shared.data.model.WatchProgress
import io.playarr.shared.data.model.Work
import io.playarr.shared.data.model.WorkChildren
import io.playarr.shared.data.model.WorkDetail
import io.playarr.shared.data.model.WorkKind

internal data class PlayarrOnDeckEpisode(
    val id: String,
    val mediaFileId: String,
    val title: String?,
    val seasonNumber: Int,
    val episodeNumber: Int,
)

internal data class PlayarrOnDeckEntry(
    val work: Work,
    /** Null for a series that is on deck only because it needs a Resume choice. */
    val progress: WatchProgress?,
    val episode: PlayarrOnDeckEpisode? = null,
    /** Set when several ways to continue apply: Home shows a stacked card and asks. */
    val resumePlan: ResumePlan? = null,
)

internal data class HomeRail(
    /** Built-in localised heading; `null` when the server supplied [literalTitle]. */
    val title: PlayarrString?,
    val works: List<Work>,
    val onDeckByWork: Map<String, PlayarrOnDeckEntry> = emptyMap(),
    /** Server-localised heading for a server-computed rail. */
    val literalTitle: String? = null,
    /** Stable key; server rails use the rail definition id. */
    val railId: String? = null,
) {
    val key: String get() = railId ?: title?.name ?: literalTitle.orEmpty()
}

internal fun resolvePlayarrOnDeckEntry(
    detail: WorkDetail,
    progress: WatchProgress?,
    resumePlan: ResumePlan? = null,
): PlayarrOnDeckEntry? {
    val stacked = resumePlan?.takeIf { it.isStacked }
    val series = detail.children as? WorkChildren.Series
        ?: return progress?.let { PlayarrOnDeckEntry(detail.work, it) }
    // A stacked series shows the plan's lead episode, not just the last one played.
    val leadMediaFileId = stacked?.target?.mediaFileId ?: progress?.mediaFileId ?: return null
    for (season in series.seasons) {
        val episode = season.episodes.firstOrNull { it.mediaFileId == leadMediaFileId } ?: continue
        return PlayarrOnDeckEntry(
            work = detail.work,
            progress = progress,
            episode = PlayarrOnDeckEpisode(
                id = episode.episode.id,
                mediaFileId = leadMediaFileId,
                title = episode.episode.title,
                seasonNumber = season.season.seasonNumber,
                episodeNumber = episode.episode.episodeNumber,
            ),
            resumePlan = stacked,
        )
    }
    return null
}

/** A server rail as a [HomeRail]; the server already localised the title and dropped empty rails. */
internal fun HomeRailDto.toHomeRail(): HomeRail =
    HomeRail(title = null, works = items, literalTitle = title, railId = id)

/**
 * Home with server-computed rails: On deck first (when there is any), then the rails the
 * server returned in the user's order, then "New sites" (the server has no site rails).
 * Falls back to the built-in New/More shelves when the server returned none (older server).
 */
internal fun buildPlayarrHomeRails(
    byKind: Map<WorkKind, List<Work>>,
    onDeck: List<PlayarrOnDeckEntry>,
    serverRails: List<HomeRailDto>,
): List<HomeRail> {
    val rails = serverRails.filter { it.items.isNotEmpty() }
    if (rails.isEmpty()) return buildPlayarrHomeRails(byKind, onDeck)
    val onDeckWorks = onDeck.map(PlayarrOnDeckEntry::work).distinctBy(Work::id).take(10)
    val onDeckIds = onDeckWorks.mapTo(mutableSetOf(), Work::id)
    return buildList {
        if (onDeckWorks.isNotEmpty()) {
            add(
                HomeRail(
                    title = PlayarrString.HomeRailOnDeck,
                    works = onDeckWorks,
                    onDeckByWork = onDeck.filter { it.work.id in onDeckIds }.associateBy { it.work.id },
                ),
            )
        }
        rails.forEach { add(it.toHomeRail()) }
        add(HomeRail(PlayarrString.HomeRailNewSites, byKind[WorkKind.Site].orEmpty().take(12)))
    }.filter { it.works.isNotEmpty() }
}

/** Mirrors Playarr Web Home's one primary rail followed by de-duplicated New/More shelves. */
internal fun buildPlayarrHomeRails(
    byKind: Map<WorkKind, List<Work>>,
    onDeck: List<PlayarrOnDeckEntry>,
): List<HomeRail> {
    val movies = byKind[WorkKind.Movie].orEmpty()
    val series = byKind[WorkKind.Series].orEmpty()
    val sites = byKind[WorkKind.Site].orEmpty()
    val supportedWorks = movies + series + sites
    val recent = supportedWorks.sortedByDescending(Work::addedAt)

    val usedIds = mutableSetOf<String>()
    fun takeUnused(source: List<Work>, count: Int): List<Work> = source
        .asSequence()
        .filter { usedIds.add(it.id) }
        .take(count)
        .toList()

    val primary = if (onDeck.isNotEmpty()) {
        takeUnused(onDeck.map(PlayarrOnDeckEntry::work), 10)
    } else {
        takeUnused(recent, 8)
    }
    val primaryIds = primary.mapTo(mutableSetOf(), Work::id)
    return listOf(
        HomeRail(
            title = if (onDeck.isNotEmpty()) PlayarrString.HomeRailOnDeck else PlayarrString.HomeRailStartWatching,
            works = primary,
            onDeckByWork = onDeck
                .filter { it.work.id in primaryIds }
                .associateBy { it.work.id },
        ),
        HomeRail(PlayarrString.HomeRailNewMovies, takeUnused(movies, 12)),
        HomeRail(PlayarrString.HomeRailNewSeries, takeUnused(series, 12)),
        HomeRail(PlayarrString.HomeRailNewSites, takeUnused(sites, 12)),
        HomeRail(PlayarrString.HomeRailMoreMovies, takeUnused(movies, 12)),
        HomeRail(PlayarrString.HomeRailMoreSeries, takeUnused(series, 12)),
        HomeRail(PlayarrString.HomeRailMoreSites, takeUnused(sites, 12)),
    ).filter { it.works.isNotEmpty() }
}

/** [rails] with the entry at [index] moved by [delta] places (clamped); the list is otherwise unchanged. */
internal fun moveRail(rails: List<RailPreferenceEntry>, index: Int, delta: Int): List<RailPreferenceEntry> {
    val target = (index + delta).coerceIn(0, rails.lastIndex)
    if (index !in rails.indices || target == index) return rails
    return rails.toMutableList().also { it.add(target, it.removeAt(index)) }
}
