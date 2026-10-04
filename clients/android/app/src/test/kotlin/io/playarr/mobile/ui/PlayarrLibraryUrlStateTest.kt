package io.playarr.mobile.ui

import org.junit.Assert.assertEquals
import org.junit.Test

class PlayarrLibraryUrlStateTest {
    @Test
    fun `defaults produce an empty query and round trip`() {
        assertEquals("", LibraryUrlState().toQuery())
        assertEquals(LibraryUrlState(), LibraryUrlState.parse(""))
    }

    @Test
    fun `web parameter names and values round trip`() {
        val state = LibraryUrlState(LibraryViewMode.CoverFlow, LibraryArtworkSize.Large, LibrarySort.DateAdded, descending = true)
        assertEquals("view=cover-flow&size=large&sort=date_added&order=desc", state.toQuery())
        assertEquals(state, LibraryUrlState.parse("view=cover-flow&size=large&sort=date_added&order=desc"))
        assertEquals(LibraryUrlState(view = LibraryViewMode.List), LibraryUrlState.parse("?view=list"))
    }

    @Test
    fun `unknown values fall back and cover flow is artist only`() {
        assertEquals(LibraryUrlState(), LibraryUrlState.parse("view=wall&size=huge&sort=rating&order=sideways"))
        assertEquals(LibraryViewMode.Screen, LibraryUrlState.parse("view=cover-flow", allowCoverFlow = false).view)
    }

    @Test
    fun `library route carries only non default state`() {
        assertEquals("series", libraryRouteFor("series", LibraryUrlState()))
        assertEquals("music?view=cover&order=desc", libraryRouteFor("music", LibraryUrlState(view = LibraryViewMode.Cover, descending = true)))
    }
}
