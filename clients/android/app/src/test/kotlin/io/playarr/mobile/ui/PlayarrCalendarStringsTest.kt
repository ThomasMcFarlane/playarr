package io.playarr.mobile.ui

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class PlayarrCalendarStringsTest {
    private val calendarStrings = PlayarrString.entries.filter {
        it.name.startsWith("Calendar") || it.name.startsWith("AvailabilityLag") || it.name.startsWith("Duration") ||
            it.name == "NavCalendar" || it.name == "ErrorSubjectCalendar"
    }

    private fun placeholders(text: String) = Regex("\\{\\{(\\w+)}}").findAll(text).map { it.groupValues[1] }.toSet()

    @Test
    fun `every calendar string is translated and keeps the same placeholders`() {
        assertTrue(calendarStrings.size > 50)
        calendarStrings.forEach { key ->
            listOf(key.english, key.thai, key.japanese).forEach { assertTrue(key.name, it.isNotBlank()) }
            assertEquals(key.name, placeholders(key.english), placeholders(key.thai))
            assertEquals(key.name, placeholders(key.english), placeholders(key.japanese))
        }
    }

    @Test
    fun `the lag sentence interpolates a duration`() {
        val english = PlayarrLanguageState("en", PlayarrResolvedLanguage.English)
        assertEquals(
            "Usually available about 2 days after release",
            english.text(PlayarrString.AvailabilityLagUsually, mapOf("duration" to "2 days")),
        )
    }
}
