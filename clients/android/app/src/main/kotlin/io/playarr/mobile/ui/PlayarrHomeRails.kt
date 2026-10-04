package io.playarr.mobile.ui

import io.playarr.shared.data.model.ResumePlan
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
    val title: PlayarrString,
    val works: List<Work>,
    val onDeckByWork: Map<String, PlayarrOnDeckEntry> = emptyMap(),
)

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
