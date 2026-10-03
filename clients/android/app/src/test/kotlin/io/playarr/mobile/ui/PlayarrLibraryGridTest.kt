package io.playarr.mobile.ui

import io.playarr.shared.data.model.WatchProgress
import io.playarr.shared.data.model.WatchState
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class PlayarrLibraryGridTest {
    private fun row(work: String, state: WatchState) = WatchProgress("m-$work-$state", work, 0, 100, state)

    @Test
    fun televisionScreenGridIsThreeAcrossAtMediumSize() {
        assertEquals(3, playarrLibraryGridColumns(LibraryViewMode.Screen, LibraryArtworkSize.Medium, true))
        assertEquals(4, playarrLibraryGridColumns(LibraryViewMode.Screen, LibraryArtworkSize.Small, true))
        assertEquals(2, playarrLibraryGridColumns(LibraryViewMode.Screen, LibraryArtworkSize.Large, true))
    }

    @Test
    fun televisionCoverGridMatchesWeb() {
        assertEquals(5, playarrLibraryGridColumns(LibraryViewMode.Cover, LibraryArtworkSize.Medium, true))
        assertEquals(6, playarrLibraryGridColumns(LibraryViewMode.Cover, LibraryArtworkSize.Small, true))
        assertEquals(4, playarrLibraryGridColumns(LibraryViewMode.Cover, LibraryArtworkSize.Large, true))
    }

    @Test
    fun nonTelevisionKeepsAdaptiveColumns() {
        assertNull(playarrLibraryGridColumns(LibraryViewMode.Screen, LibraryArtworkSize.Medium, false))
        assertNull(playarrLibraryGridColumns(LibraryViewMode.List, LibraryArtworkSize.Medium, true))
    }

    @Test
    fun progressIndexPrefersPartWatchedThenWatched() {
        val indexed = indexPlayarrProgressByWork(
            listOf(row("a", WatchState.Watched), row("a", WatchState.PartWatched), row("a", WatchState.Unseen), row("b", WatchState.Unseen), row("b", WatchState.Watched)),
        )
        assertEquals(WatchState.PartWatched, indexed.getValue("a").state)
        assertEquals(WatchState.Watched, indexed.getValue("b").state)
    }

    @Test
    fun unwatchedDotRules() {
        assertTrue(shouldShowPlayarrUnwatchedDot(row("a", WatchState.Unseen), progressLoaded = false))
        assertTrue(shouldShowPlayarrUnwatchedDot(null, progressLoaded = true))
        assertFalse(shouldShowPlayarrUnwatchedDot(null, progressLoaded = false))
        assertFalse(shouldShowPlayarrUnwatchedDot(row("a", WatchState.Watched), progressLoaded = true))
        assertFalse(shouldShowPlayarrUnwatchedDot(row("a", WatchState.PartWatched), progressLoaded = true))
    }
}
