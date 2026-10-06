package io.playarr.mobile.ui

import java.io.File
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * On the search page, Up from the Filters button must land on the search field, not the page Back button
 * (TASKS rows 53, 174). Spatial search alone picked Back on Android TV; the web TV page already sends Up
 * from Filters to the field explicitly, so Android pins the same order.
 */
class PlayarrSearchFocusOrderTest {
    private val source: String by lazy {
        val base = if (File("src/main").isDirectory) File(".") else File("clients/android/app")
        File(base, "src/main/kotlin/io/playarr/mobile/ui/PlayarrExperience.kt").readText()
    }

    @Test
    fun `filters button sends up to the search field`() {
        assertTrue(source.contains("val searchFieldFocus = remember { FocusRequester() }"))
        assertTrue(source.contains(".focusRequester(searchFieldFocus)"))
        assertTrue(source.contains(".focusProperties { up = searchFieldFocus }"))
    }
}
