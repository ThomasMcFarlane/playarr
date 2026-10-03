package io.playarr.mobile.ui

import io.playarr.shared.data.model.WatchProgress
import io.playarr.shared.data.model.WatchState

/**
 * Column counts for the television library grid, mirroring the web
 * `.tv-title-grid-content` rules: three-up landscape cards by default (four
 * small, two large) and five-up covers (six small, four large). Non-television
 * layouts keep adaptive sizing, signalled by `null`.
 */
internal fun playarrLibraryGridColumns(
    viewMode: LibraryViewMode,
    artworkSize: LibraryArtworkSize,
    isTelevision: Boolean,
): Int? {
    if (!isTelevision) return null
    return when (viewMode) {
        LibraryViewMode.Screen -> when (artworkSize) {
            LibraryArtworkSize.Small -> 4
            LibraryArtworkSize.Medium -> 3
            LibraryArtworkSize.Large -> 2
        }
        LibraryViewMode.Cover -> when (artworkSize) {
            LibraryArtworkSize.Small -> 6
            LibraryArtworkSize.Medium -> 5
            LibraryArtworkSize.Large -> 4
        }
        else -> null
    }
}

/** One progress row per work; part-watched beats watched beats unseen (web `indexWatchProgressByWork`). */
internal fun indexPlayarrProgressByWork(rows: List<WatchProgress>): Map<String, WatchProgress> {
    fun priority(state: WatchState) = when (state) {
        WatchState.PartWatched -> 2
        WatchState.Watched -> 1
        WatchState.Unseen -> 0
    }
    val byWork = LinkedHashMap<String, WatchProgress>()
    for (row in rows) {
        val current = byWork[row.workId]
        if (current == null || priority(row.state) > priority(current.state)) byWork[row.workId] = row
    }
    return byWork
}

/** Web `WatchStateOverlay`: dot for an explicitly unseen work, or no progress once progress has loaded. */
internal fun shouldShowPlayarrUnwatchedDot(progress: WatchProgress?, progressLoaded: Boolean): Boolean =
    progress?.state == WatchState.Unseen || (progress == null && progressLoaded)
