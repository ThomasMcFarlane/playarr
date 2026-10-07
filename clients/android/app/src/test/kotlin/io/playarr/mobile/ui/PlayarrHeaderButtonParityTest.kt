package io.playarr.mobile.ui

import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The Calendar's header buttons (Filters, Calendar link) and the Filters button on every other page are one
 * component: [PlayarrHeaderButton] on television and [PlayarrPhoneHeaderPill] on phones, with the metrics of
 * the web's `.page-filters-button`. This guards against a page restyling its own buttons (or the shared one
 * being bent to suit a single page) so the two can never drift apart again.
 */
class PlayarrHeaderButtonParityTest {
    private fun ui(name: String): String {
        val dir = File("src/main/kotlin/io/playarr/mobile/ui").takeIf { it.isDirectory }
            ?: File("app/src/main/kotlin/io/playarr/mobile/ui")
        return File(dir, name).readText()
    }

    private fun headerButtonBody(): String {
        val scaffold = ui("PlayarrPageScaffold.kt")
        val start = scaffold.indexOf("internal fun PlayarrHeaderButton(")
        return scaffold.substring(start, scaffold.indexOf("internal fun PlayarrFiltersSheet(", start))
    }

    @Test
    fun `the shared header button carries the web metrics`() {
        val body = headerButtonBody()
        listOf(
            "widthIn(min = 62.dp).height(72.dp)",
            "Modifier.size(44.dp)",
            "RoundedCornerShape(14.dp)",
            "fontSize = 8.256.sp",
            "FontWeight.Bold",
            "size(24.dp)",
            "WebSurfaceStrong.copy(alpha = 0.78f)",
            "if (active) WebInk",
            "WebLauncherBorder",
            "focusScale = if (focused) 1.06f",
        ).forEach { assertTrue("PlayarrHeaderButton must keep $it (web .page-filters-button)", body.contains(it)) }
    }

    @Test
    fun `Filters everywhere and the calendar buttons are drawn by the same two composables`() {
        val scaffold = ui("PlayarrPageScaffold.kt")
        val actions = scaffold.substring(scaffold.indexOf("internal fun PlayarrHeaderActions("), scaffold.indexOf("enum class PlayarrSubtitlePlacement"))
        assertTrue("page Filters is drawn by PlayarrHeaderButton", actions.contains("PlayarrHeaderButton("))
        assertTrue("with the web's sliders glyph", actions.contains("icon = PlayarrWebIcons.Filters"))
        val calendar = ui("PlayarrCalendar.kt")
        val header = calendar.substring(calendar.indexOf("val panelActions:"), calendar.indexOf("val navigation:"))
        assertTrue("Calendar link uses PlayarrHeaderButton on TV", header.contains("PlayarrHeaderButton("))
        assertTrue("phones draw the bell with the same PlayarrHeaderButton", header.contains("isTelevision = false"))
        assertTrue("Calendar Filters goes through the scaffold", calendar.contains("filters = PlayarrFilterAction("))
        listOf("Surface(", "OutlinedButton(", "FilterChip(", "PlayarrButton(").forEach {
            assertTrue("the calendar header must not hand-draw its buttons with $it", !header.contains(it))
        }
        // Every page that has Filters hands the scaffold a PlayarrFilterAction; none draws a launcher of its own.
        val others = listOf("PlayarrExperience.kt", "PlayarrFolders.kt", "PlayarrParityScreens.kt")
        others.forEach { assertTrue("$it must pass filters = PlayarrFilterAction(", ui(it).contains("PlayarrFilterAction(")) }
        assertEquals(emptyList<String>(), others.filter { ui(it).contains("Icons.Outlined.Tune") })
    }
}
