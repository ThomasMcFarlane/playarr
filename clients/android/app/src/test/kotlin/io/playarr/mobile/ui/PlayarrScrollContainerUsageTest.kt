package io.playarr.mobile.ui

import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Every scrollable container shows the web scroll-edge fade wherever content continues off-screen (owner rule), so
 * screens use the shared containers in PlayarrScrollContainers.kt and never the raw Compose scrollers. The Calendar
 * screens are owned by the calendar work and migrate there; they are the only allowance.
 */
class PlayarrScrollContainerUsageTest {
    private val raw = Regex("""(^|[^A-Za-z.])(LazyColumn|LazyRow|LazyVerticalGrid|LazyVerticalStaggeredGrid|LazyHorizontalGrid)\(|(^|[^A-Za-z])(verticalScroll|horizontalScroll)\(""")

    private fun uiDirectory(): File {
        val base = if (File("src/main").isDirectory) File(".") else File("clients/android/app")
        return File(base, "src/main/kotlin/io/playarr/mobile/ui")
    }

    private val migrated = { file: File -> !file.name.startsWith("PlayarrCalendar") && file.name != "PlayarrScrollContainers.kt" }

    @Test
    fun `no raw scrollers remain outside the shared containers and the calendar`() {
        val offenders = uiDirectory().walkTopDown().filter { it.extension == "kt" && migrated(it) }
            .associate { it.name to it.readLines().count { line -> raw.containsMatchIn(line) } }
            .filterValues { it > 0 }
        assertEquals("use PlayarrLazyColumn / PlayarrLazyRow / PlayarrLazyVerticalGrid / playarrVerticalScroll / playarrHorizontalScroll", emptyMap<String, Int>(), offenders)
    }

    @Test
    fun `the shared containers draw the fade`() {
        val text = File(uiDirectory(), "PlayarrScrollContainers.kt").readText()
        listOf("fun PlayarrLazyColumn(", "fun PlayarrLazyRow(", "fun PlayarrLazyVerticalGrid(", "fun Modifier.playarrVerticalScroll(", "fun Modifier.playarrHorizontalScroll(").forEach {
            assertTrue("$it must exist", text.contains(it))
        }
        assertTrue(text.split("playarrScrollFade(").size - 1 >= 5)
    }

    @Test
    fun `the covered containers are listed`() {
        // docs/architecture/clients/android-tv.md lists the covered screens; this guards the main ones.
        val covered = uiDirectory().walkTopDown().filter { it.extension == "kt" && migrated(it) }
            .filter { Regex("""PlayarrLazy(Column|Row|VerticalGrid)\(|playarr(Vertical|Horizontal)Scroll\(""").containsMatchIn(it.readText()) }
            .map { it.name }.sorted().toList()
        assertTrue("expected the main screens to own fading scrollers, found $covered", covered.containsAll(listOf("PlayarrExperience.kt", "PlayarrParityScreens.kt", "PlayarrDownloads.kt", "PlayarrPageScaffold.kt")))
    }
}
