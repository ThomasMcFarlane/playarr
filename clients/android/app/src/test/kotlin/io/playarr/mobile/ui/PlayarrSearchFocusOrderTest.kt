package io.playarr.mobile.ui

import java.io.File
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The Search page's Filters is a header action like every other page's (docs/design/page-layout.md A2): the shared page
 * header draws it last in the action slot, so the page no longer places its own pill. Down from the header enters the
 * content and Up from the search field returns to the header by geometry (web spatial nav), so the page pins no
 * focus property of its own for it (TASKS rows 53, 174).
 */
class PlayarrSearchFocusOrderTest {
    private val source: String by lazy {
        val base = if (File("src/main").isDirectory) File(".") else File("clients/android/app")
        File(base, "src/main/kotlin/io/playarr/mobile/ui/PlayarrExperience.kt").readText()
    }

    @Test
    fun `search filters is a header action`() {
        val search = source.substring(source.indexOf("title = playarrString(PlayarrString.SearchTitle)"))
        assertTrue(search.take(900).contains("filters = PlayarrFilterAction("))
        assertTrue(search.take(900).contains("PlayarrString.SearchFilters"))
    }

    @Test
    fun `search draws no pill of its own`() {
        assertFalse(source.contains("tv-search-filter-button"))
        assertFalse(source.contains(".focusProperties { up = searchFieldFocus }"))
    }
}
