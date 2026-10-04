package io.playarr.mobile.ui

import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Every pop-out panel uses the one shared [PlayarrFiltersSheet] (title, shared icon close button, body,
 * footer actions, focus trap, Back closes). Ad-hoc bottom sheets and hand-made close icons are blocked;
 * the legacy allowance below may only shrink (TASKS row 225 tracks converting the remaining panels).
 */
class PlayarrSidePanelUsageTest {
    private val legacyBottomSheets = mapOf("PlayarrDownloads.kt" to 1)
    private val closeIcon = Regex("""Icons\.(Outlined|Default|Filled|Rounded)\.Close""")

    private fun uiFiles(): List<File> {
        val dir = File("src/main/kotlin/io/playarr/mobile/ui").takeIf { it.isDirectory }
            ?: File("app/src/main/kotlin/io/playarr/mobile/ui")
        return dir.listFiles { f -> f.extension == "kt" }!!.toList()
    }

    @Test
    fun `no new ad-hoc bottom sheets or hand-made close buttons`() {
        val sheets = uiFiles().associate { it.name to it.readText().split("ModalBottomSheet(").size - 1 }
            .filterValues { it > 0 }.filter { (name, n) -> n > (legacyBottomSheets[name] ?: 0) }
        assertEquals("use PlayarrFiltersSheet", emptyMap<String, Int>(), sheets)
        val closes = uiFiles().filter { it.name != "PlayarrPageScaffold.kt" }
            .filter { closeIcon.containsMatchIn(it.readText()) }.map { it.name }
        assertEquals("close controls come from PlayarrFiltersSheet's shared icon button", emptyList<String>(), closes)
    }

    @Test
    fun `the shared panel carries footer actions and the pages with Filters share one header cluster`() {
        val scaffold = uiFiles().first { it.name == "PlayarrPageScaffold.kt" }.readText()
        assertTrue(scaffold.contains("footer: (@Composable RowScope.() -> Unit)? = null"))
        assertTrue(scaffold.contains("fun PlayarrHeaderActions("))
        // Calendar goes through the scaffold's filters slot, Library through PlayarrHeaderActions directly:
        // the same composable draws Filters on both, so bounds are identical by construction.
        assertTrue(scaffold.contains("PlayarrHeaderActions("))
        val calendar = uiFiles().first { it.name == "PlayarrCalendar.kt" }.readText()
        val library = uiFiles().first { it.name == "PlayarrExperience.kt" }.readText()
        assertTrue(calendar.contains("filters = PlayarrFilterAction("))
        assertTrue(library.contains("PlayarrHeaderActions("))
        assertTrue("Library must not keep its floating Filters launcher", !library.contains("Icons.Outlined.FilterList, playarrString(PlayarrString.LibraryFilters)"))
        assertTrue("the library filters open in the shared sheet", library.contains("PlayarrFiltersSheet("))
    }
}
