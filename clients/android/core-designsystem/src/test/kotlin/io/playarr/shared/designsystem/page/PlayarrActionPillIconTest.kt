package io.playarr.shared.designsystem.page

import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Pins the "phone Create pill drew the Filters glyph" bug: the icon parameter is honoured on both form factors. */
class PlayarrActionPillIconTest {
    @Test
    fun everyLineIconHasItsOwnVector() {
        val lineIcons = PlayarrActionIcon.entries.filter { it.glyph == null }
        assertTrue(lineIcons.containsAll(listOf(PlayarrActionIcon.Filters, PlayarrActionIcon.Bell, PlayarrActionIcon.Add, PlayarrActionIcon.Customise)))
        lineIcons.forEach { assertNotNull("$it needs a vector", it.vector) }
        assertEquals("vectors must be distinct", lineIcons.size, lineIcons.map { it.vector!!.name }.toSet().size)
        assertTrue(PlayarrActionIcon.Add.vector!!.name != PlayarrActionIcon.Filters.vector!!.name)
    }

    @Test
    fun theArrowsAreTextGlyphs() {
        listOf(PlayarrActionIcon.Prev, PlayarrActionIcon.Next, PlayarrActionIcon.Back).forEach {
            assertNotNull(it.glyph)
        }
    }

    @Test
    fun bothFormFactorBranchesDrawTheGivenIcon() {
        val source = File("src/main/kotlin/io/playarr/shared/designsystem/page/PlayarrActionPill.kt").readText()
        // One vector read, drawn by both the television tile and the phone square.
        assertEquals(1, Regex("""val vector = icon\.vector""").findAll(source).count())
        assertEquals(2, Regex("""Icon\(vector, contentDescription = null""").findAll(source).count())
        assertTrue("the phone branch must not hard-code a glyph", !source.contains("PlayarrWebIcons."))
    }
}
