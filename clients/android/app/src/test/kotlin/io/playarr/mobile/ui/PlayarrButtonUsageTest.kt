package io.playarr.mobile.ui

import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Enforces the single Playarr button family (`PlayarrButton` / `PlayarrIconButton` in core-designsystem).
 * Raw Material buttons may not appear anywhere in the client; there is no allowance left (TASKS row 224).
 */
class PlayarrButtonUsageTest {
    private val raw = Regex("""(^|[^A-Za-z])(Button|OutlinedButton|TextButton|IconButton|FilledTonalButton|ElevatedButton|FilledIconButton|OutlinedIconButton)\(""")

    private fun roots(): List<File> {
        val base = if (File("src/main").isDirectory) File("..") else File("clients/android")
        return listOf("app", "core-designsystem", "core-auth", "core-data", "core-domain", "core-download", "core-player", "core-update")
            .map { File(base, "$it/src/main") }.filter(File::isDirectory)
    }

    @Test
    fun `no raw Material buttons remain anywhere in the client`() {
        val counts = roots().flatMap { root -> root.walkTopDown().filter { it.extension == "kt" }.toList() }
            .associate { it.name to it.readLines().count { line -> raw.containsMatchIn(line) } }
            .filterValues { it > 0 }
        assertEquals("use PlayarrButton / PlayarrIconButton from core-designsystem instead of raw Material buttons", emptyMap<String, Int>(), counts)
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
