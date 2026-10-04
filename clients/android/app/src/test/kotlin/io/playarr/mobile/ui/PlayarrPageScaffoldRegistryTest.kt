package io.playarr.mobile.ui

import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Keeps every routed screen on the shared page frame. A new `Experience*Screen` composable must either
 * render through [PlayarrPageScaffold] / [PlayarrPageHeader] (back, title, actions, bottom-left safe
 * area) or be listed below with a reason, so pages cannot drift from the canonical layout.
 */
class PlayarrPageScaffoldRegistryTest {
    /** Screens exempt from the shared frame, with the reason. */
    private val exempt = mapOf(
        "ExperienceProfilesScreen" to "Profile picker with its own chrome",
        "ExperienceParitySettingsScreen" to "Two-pane settings workspace; header adoption tracked in TASKS row 222",
        "ExperiencePlaylistDetailScreen" to "Detail view with its own back header",
        "ExperienceLibraryScreen" to "Uses PlayarrPageHeader plus the library Filters launcher",
        "ExperienceNotFoundScreen" to "404 illustration",
        "ExperienceOfflineScreen" to "Offline gate shown instead of a page",
        "ExperienceHomeScreen" to "Root surface: nothing to go back to; hero replaces the title row",
        "ExperienceDetailScreen" to "Detail pages render PlayarrPageHeader through their own layout; adoption tracked in TASKS row 222",
        "ExperiencePlayerScreen" to "Full-bleed playback with its own transport chrome",
        "ExperienceLoadingScreen" to "Transient loading state",
    )

    private val screenFunction = Regex("""(?:private|internal)?\s*fun\s+(Experience\w*Screen)\s*\(""")

    private fun uiSources(): List<File> {
        val dir = File("src/main/kotlin/io/playarr/mobile/ui").takeIf { it.isDirectory }
            ?: File("app/src/main/kotlin/io/playarr/mobile/ui")
        return dir.listFiles { f -> f.extension == "kt" }!!.toList()
    }

    private fun bodyOf(text: String, start: Int): String {
        val end = Regex("""\n}\n""").find(text, start)?.range?.last ?: text.length
        return text.substring(start, end)
    }

    @Test
    fun `every routed screen renders through the shared page scaffold or is exempt with a reason`() {
        val screens = mutableMapOf<String, String>()
        uiSources().forEach { file ->
            val text = file.readText()
            screenFunction.findAll(text).forEach { m -> screens[m.groupValues[1]] = bodyOf(text, m.range.first) }
        }
        assertTrue("expected to discover the screen composables", screens.size >= 6)
        val bypassing = screens.filter { (name, body) ->
            name !in exempt && !body.contains("PlayarrPageScaffold(") && !body.contains("PlayarrPageHeader(")
        }.keys
        assertEquals("screens bypassing PlayarrPageScaffold (add it, or exempt with a reason)", emptySet<String>(), bypassing)
        exempt.forEach { (name, reason) -> assertTrue("$name needs a reason", reason.length > 10) }
    }

    @Test
    fun `the calendar uses the shared scaffold, filters sheet, master-detail and skeleton`() {
        val calendar = uiSources().first { it.name == "PlayarrCalendar.kt" }.readText()
        listOf("PlayarrPageScaffold(", "PlayarrFiltersSheet(", "PlayarrMasterDetail(", "PlayarrSkeleton(", "PlayarrViewToggle(").forEach {
            assertTrue("calendar must use $it", calendar.contains(it))
        }
    }
}
