package io.playarr.mobile.ui

import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The Calendar's header buttons (Filters, Calendar link) and the Filters button on every other page are one
 * component: the page package's `PlayarrActionPill` on television and phones, with the metrics of
 * the web's `.page-filters-button`. This guards against a page restyling its own buttons (or the shared one
 * being bent to suit a single page) so the two can never drift apart again.
 */
class PlayarrHeaderButtonParityTest {
    private fun ui(name: String): String {
        val dir = File("src/main/kotlin/io/playarr/mobile/ui").takeIf { it.isDirectory }
            ?: File("app/src/main/kotlin/io/playarr/mobile/ui")
        return File(dir, name).readText()
    }

    private fun pageSource(name: String): String {
        val dir = File("../core-designsystem/src/main/kotlin/io/playarr/shared/designsystem/page").takeIf { it.isDirectory }
            ?: File("core-designsystem/src/main/kotlin/io/playarr/shared/designsystem/page")
        return File(dir, name).readText()
    }

    @Test
    fun `the shared action pill carries the web metrics`() {
        val body = pageSource("PlayarrActionPill.kt")
        listOf(
            "widthIn(min = metrics.pillWidth).height(metrics.pillHeight)",
            "Modifier.size(metrics.pillWidth, metrics.pillHeight)",
            "RoundedCornerShape(metrics.pillRadius)",
            "fontSize = 8.256.sp",
            "FontWeight.Bold",
            "size(24.dp)",
            "palette.surfaceStrong.copy(alpha = 0.78f)",
            "if (active) palette.ink",
            "palette.launcherBorder",
            "focusScale = if (focused) 1.06f",
        ).forEach { assertTrue("PlayarrActionPill must keep $it (web .page-filters-button)", body.contains(it)) }
    }

    @Test
    fun `Filters everywhere and the calendar buttons are drawn by the same two composables`() {
        val scaffold = ui("PlayarrPageScaffold.kt")
        val actions = pageSource("PlayarrPageLayout.kt")
        assertTrue("page Filters is drawn by the one action pill", actions.contains("PlayarrActionPill(PlayarrActionIcon.Filters"))
        assertTrue("the scaffold hands Filters to the page layout", scaffold.contains("PlayarrPageAction.Filters("))
        val calendar = ui("PlayarrCalendar.kt")
        val header = calendar.substring(calendar.indexOf("val panelActions:"), calendar.indexOf("val navigation:"))
        assertTrue("Calendar link uses PlayarrHeaderButton on TV", header.contains("PlayarrHeaderButton("))
        assertTrue("with the bell glyph from the one icon map", header.contains("PlayarrActionIcon.Bell"))
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
