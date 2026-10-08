package io.playarr.mobile.ui

import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Source guard for page chrome (docs/design/page-layout.md section 7.2). The page header, its actions and the action pill
 * belong to `core-designsystem`'s page package; a screen describes what it needs and cannot draw its own. Each rule
 * below has an allow-list that may only shrink as the migration proceeds (A3 to A7).
 */
class PlayarrPageChromeGuardTest {
    private fun uiDir(): File = File("src/main/kotlin/io/playarr/mobile/ui").takeIf { it.isDirectory }
        ?: File("app/src/main/kotlin/io/playarr/mobile/ui")

    private fun uiFiles(): List<File> = uiDir().listFiles { f -> f.extension == "kt" }!!.sortedBy { it.name }

    @Test
    fun `header pieces are never called outside the page package`() {
        val banned = listOf("PlayarrHeaderButton(", "PlayarrPhoneHeaderPill(", "PlayarrPageHeaderRow(", "PlayarrHeaderActions(", "PlayarrActionPill(")
        val hits = uiFiles().flatMap { f ->
            val text = f.readText()
            banned.filter { text.contains(it) }.map { "${f.name}: $it" }
        }
        assertEquals("screens describe actions (PlayarrPageAction); they never draw header pieces", emptyList<String>(), hits)
    }

    /** A clickable `Surface` with a round shape and a pill height is a hand-rolled header pill. */
    @Test
    fun `no hand-rolled round pills in screens`() {
        // Calendar period arrows and Today move onto the navigation action in A6; the profile picker is registry-exempt.
        val allowed = setOf("PlayarrCalendar.kt", "PlayarrPhoneProfiles.kt")
        val pillHeights = Regex("""\.(size|height)\((\d+(\.\d+)?)\.dp[,)]""")
        val offenders = uiFiles().filter { it.name !in allowed }.flatMap { f ->
            val text = f.readText()
            Regex("""Surface\(\s*onClick = [^)]*?shape = CircleShape""", RegexOption.DOT_MATCHES_ALL).findAll(text)
                // The profile picker is registry-exempt (own chrome, not a routed page header).
                .filterNot { m -> text.substring(maxOf(0, m.range.first - 300), m.range.first).contains("profile", ignoreCase = true) }
                .filter { m ->
                    val window = text.substring(m.range.first, minOf(text.length, m.range.last + 400))
                    pillHeights.findAll(window).any { h -> h.groupValues[2].toDouble() in setOf(38.0, 42.0, 44.0, 50.0, 56.0) }
                }
                .map { m -> "${f.name}@${m.range.first}" }.toList()
        }
        assertEquals("header pills come from PlayarrPageAction, not a hand-rolled Surface", emptyList<String>(), offenders)
    }
}
