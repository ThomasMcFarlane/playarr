package io.playarr.mobile.ui

import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Keeps every routed screen on the shared page frame. A new `Experience*Screen` composable must either
 * render through [PlayarrPageScaffold] (back, title, actions, bottom-left safe area; `padBody = false`
 * for full-bleed hero pages such as Library and the detail screens) or be listed below with a reason, so
 * pages cannot drift from the canonical layout. Settings, playlist detail, Library and detail pages are
 * no longer exempt (TASKS rows 222, 224, 225).
 */
class PlayarrPageScaffoldRegistryTest {
    /** Screens exempt from the shared frame, with the reason. */
    private val exempt = mapOf(
        "ExperienceProfilesScreen" to "Profile picker with its own chrome",
        "ExperienceNotFoundScreen" to "404 illustration",
        "ExperienceOfflineScreen" to "Offline gate shown instead of a page",
        "ExperienceHomeScreen" to "Root surface: nothing to go back to; hero replaces the title row",
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
        assertTrue("expected to discover the screen composables", screens.size >= 12)
        val bypassing = screens.filter { (name, body) ->
            name !in exempt && !body.contains("PlayarrPageScaffold(")
        }.keys
        assertEquals("screens bypassing PlayarrPageScaffold (add it, or exempt with a reason)", emptySet<String>(), bypassing)
        exempt.forEach { (name, reason) -> assertTrue("$name needs a reason", reason.length > 10) }
    }

    @Test
    fun `the exempt list only names screens that still exist`() {
        val found = mutableSetOf<String>()
        uiSources().forEach { file -> screenFunction.findAll(file.readText()).forEach { found += it.groupValues[1] } }
        assertEquals("stale exemptions", emptySet<String>(), exempt.keys - found - setOf("ExperienceLoadingScreen"))
    }

    @Test
    fun `the calendar uses the shared scaffold, filters sheet, master-detail and skeleton`() {
        val calendar = uiSources().first { it.name == "PlayarrCalendar.kt" }.readText()
        listOf("PlayarrPageScaffold(", "PlayarrFiltersSheet(", "PlayarrMasterDetail(", "PlayarrSkeleton(", "PlayarrViewToggle(").forEach {
            assertTrue("calendar must use $it", calendar.contains(it))
        }
    }
}
