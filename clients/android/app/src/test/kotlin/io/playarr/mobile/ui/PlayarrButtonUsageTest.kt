package io.playarr.mobile.ui

import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Enforces the single Playarr button family (`PlayarrButton` / `PlayarrIconButton` in core-designsystem).
 * Raw Material buttons may not appear in a migrated file, and the legacy files below may only shrink:
 * lower a count when you migrate buttons, never raise it. New files get no allowance.
 */
class PlayarrButtonUsageTest {
    /** Remaining raw Material button call sites per legacy file (ratchet; see TASKS row 224). */
    private val legacyAllowance = mapOf(
        "PlayarrPlaybackHealth.kt" to 7,
        "PlayarrYourData.kt" to 13,
        "PlayarrAvatarEditor.kt" to 4,
        "PlayarrInvite.kt" to 3,
        "PlayarrApp.kt" to 5,
        "PlayarrRemote.kt" to 13,
        "PlayarrPlayerChrome.kt" to 10,
        "PlayarrHousehold.kt" to 2,
        "PlayarrParityScreens.kt" to 44,
        "PlayarrDownloads.kt" to 8,
        "PlayarrDiscovery.kt" to 8,
        "PlayarrExperience.kt" to 34,
    )

    private val raw = Regex("""(^|[^A-Za-z])(Button|OutlinedButton|TextButton|IconButton|FilledTonalButton|ElevatedButton|FilledIconButton|OutlinedIconButton)\(""")

    private fun roots(): List<File> {
        val base = if (File("src/main").isDirectory) File("..") else File("clients/android")
        return listOf("app", "core-designsystem", "core-auth", "core-data", "core-domain", "core-download", "core-player", "core-update")
            .map { File(base, "$it/src/main") }.filter(File::isDirectory)
    }

    @Test
    fun `raw Material buttons stay inside the legacy allowance`() {
        val counts = roots().flatMap { root -> root.walkTopDown().filter { it.extension == "kt" }.toList() }
            .associate { it.name to it.readLines().count { line -> raw.containsMatchIn(line) } }
            .filterValues { it > 0 }
        val over = counts.filter { (file, n) -> n > (legacyAllowance[file] ?: 0) }
        assertEquals("use PlayarrButton / PlayarrIconButton from core-designsystem instead of raw Material buttons", emptyMap<String, Int>(), over)
    }

    @Test
    fun `the design system exposes the button family and the calendar and scaffold are fully migrated`() {
        val ds = roots().first { it.path.contains("core-designsystem") }
            .walkTopDown().first { it.name == "PlayarrButtons.kt" }.readText()
        listOf("fun PlayarrButton(", "fun PlayarrIconButton(", "Primary", "Secondary", "Ghost", "Small", "Large").forEach {
            assertTrue("design system must define $it", ds.contains(it))
        }
        val ui = roots().first { it.path.endsWith("app/src/main") }.walkTopDown()
        listOf("PlayarrCalendar.kt", "PlayarrPageScaffold.kt").forEach { name ->
            val text = ui.first { it.name == name }.readText()
            assertTrue("$name must not use raw Material buttons", text.lines().none { raw.containsMatchIn(it) })
        }
    }
}
