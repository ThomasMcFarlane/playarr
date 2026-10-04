package io.playarr.mobile.ui

import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Every pop-out panel uses the one shared sheet ([PlayarrFiltersSheet], or [PlayarrPanel] which renders in it:
 * title, shared icon close button, body, footer actions, focus trap, Back closes). Ad-hoc bottom sheets,
 * Material dialogs and hand-made close icons are blocked with no allowance left (TASKS row 225). Anchored
 * dropdown menus (language and theme pickers) are menus, not pop-outs, and stay as they are.
 */
class PlayarrSidePanelUsageTest {
    private val bannedPopOuts = listOf("ModalBottomSheet(", "AlertDialog(", "DatePickerDialog(", "BasicAlertDialog(")
    private val closeIcon = Regex("""Icons\.(Outlined|Default|Filled|Rounded)\.Close""")

    private fun uiFiles(): List<File> {
        val dir = File("src/main/kotlin/io/playarr/mobile/ui").takeIf { it.isDirectory }
            ?: File("app/src/main/kotlin/io/playarr/mobile/ui")
        return dir.listFiles { f -> f.extension == "kt" }!!.toList()
    }

    @Test
    fun `no new ad-hoc bottom sheets or hand-made close buttons`() {
        val popOuts = uiFiles().associate { f ->
            val text = f.readText()
            f.name to bannedPopOuts.sumOf { call -> Regex("""(^|[^A-Za-z.])""" + Regex.escape(call)).findAll(text).count() }
        }.filterValues { it > 0 }
        assertEquals("use PlayarrFiltersSheet / PlayarrPanel", emptyMap<String, Int>(), popOuts)
        val rawDialogs = uiFiles().filter { it.name != "PlayarrPageScaffold.kt" }
            .filter { Regex("""(^|[^A-Za-z.])Dialog\(""").containsMatchIn(it.readText()) }.map { it.name }
        assertEquals("only the shared sheet frame may open a Dialog", emptyList<String>(), rawDialogs)
        val closes = uiFiles().filter { it.name != "PlayarrPageScaffold.kt" }
            .filter { closeIcon.containsMatchIn(it.readText()) }.map { it.name }
        assertEquals("close controls come from PlayarrFiltersSheet's shared icon button", emptyList<String>(), closes)
    }

    @Test
    fun `the shared panel carries footer actions and the pages with Filters share one header cluster`() {
        val scaffold = uiFiles().first { it.name == "PlayarrPageScaffold.kt" }.readText()
        assertTrue(scaffold.contains("footer: (@Composable RowScope.() -> Unit)? = null"))
        assertTrue(scaffold.contains("fun PlayarrHeaderActions("))
        // Calendar and Library both pass `filters = PlayarrFilterAction(...)` to the scaffold, which draws:
        // the same composable draws Filters on both, so bounds are identical by construction.
        assertTrue(scaffold.contains("PlayarrHeaderActions("))
        val calendar = uiFiles().first { it.name == "PlayarrCalendar.kt" }.readText()
        val library = uiFiles().first { it.name == "PlayarrExperience.kt" }.readText()
        assertTrue(calendar.contains("filters = PlayarrFilterAction("))
        assertTrue(library.contains("filters = PlayarrFilterAction("))
        assertTrue("Library must not keep its floating Filters launcher", !library.contains("Icons.Outlined.FilterList, playarrString(PlayarrString.LibraryFilters)"))
        assertTrue("the library filters open in the shared sheet", library.contains("PlayarrFiltersSheet("))
        assertTrue("Library must render its Filters through the scaffold", library.contains("filters = PlayarrFilterAction("))
    }
}
