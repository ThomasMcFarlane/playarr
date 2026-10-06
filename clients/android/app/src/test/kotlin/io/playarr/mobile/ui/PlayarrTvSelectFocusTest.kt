package io.playarr.mobile.ui

import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * `Modifier.clickable` and `combinedClickable` already make the node focusable. A bare `.focusable()` placed
 * in front of them adds a second focus target, so on television the D-pad lands on the inert outer one and
 * the first Select (physical remote or phone remote) does nothing until a second press (TASKS rows 53, 174).
 * Use `onFocusChanged` before the clickable instead.
 */
class PlayarrTvSelectFocusTest {
    private val doubleTarget = Regex("""\.focusable\(\)\s*\.(combinedClickable|clickable)\(""")

    @Test
    fun `no bare focusable is chained in front of a clickable`() {
        val base = if (File("src/main").isDirectory) File("..") else File("clients/android")
        val offenders = listOf("app", "core-designsystem")
            .map { File(base, "$it/src/main") }.filter(File::isDirectory)
            .flatMap { root -> root.walkTopDown().filter { it.extension == "kt" }.toList() }
            .filter { doubleTarget.containsMatchIn(it.readText()) }
            .map { it.name }
        assertEquals("remove the redundant .focusable() before the clickable", emptyList<String>(), offenders)
    }
}
