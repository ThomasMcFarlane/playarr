package io.playarr.mobile.ui

import io.playarr.mobile.connected.mergeLanguageFacets
import io.playarr.shared.data.model.LanguageFacetEntry
import java.util.Locale
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class PlayarrLanguageFiltersTest {
    @Test
    fun `selection toggles and renders sorted query parameters`() {
        val selection = LanguageSelection().toggleAudio("ja").toggleAudio("en").toggleSubtitle("fr")
        assertEquals("en,ja", selection.audioParam)
        assertEquals("fr", selection.subtitleParam)
        assertEquals(null, selection.toggleSubtitle("fr").subtitleParam)
        assertEquals("en", selection.toggleAudio("ja").audioParam)
        assertTrue(LanguageSelection().isEmpty)
        assertNull(LanguageSelection().audioParam)
    }

    @Test
    fun `names are localised and fall back to the server name or code`() {
        assertEquals("Japanese", languageDisplayName("ja", Locale.ENGLISH))
        assertEquals("日本語", languageDisplayName("ja", Locale.JAPANESE))
        assertEquals("Fallback", languageDisplayName("xx", Locale.ENGLISH, "Fallback"))
    }

    @Test
    fun `joined servers merge language counts`() {
        val merged = mergeLanguageFacets(
            listOf(
                listOf(LanguageFacetEntry("en", "English", 2), LanguageFacetEntry("ja", null, 1)),
                listOf(LanguageFacetEntry("ja", "Japanese", 4)),
            ),
        )
        assertEquals(listOf("ja", "en"), merged.map { it.code })
        assertEquals(5L, merged.first().count)
        assertEquals("Japanese", merged.first().name)
    }
}
