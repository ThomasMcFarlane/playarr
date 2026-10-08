package io.playarr.mobile.ui

import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
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
        // The profile picker is registry-exempt.
        val allowed = setOf("PlayarrPhoneProfiles.kt")
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

    /** One loading, empty and error family, owned by the page package (spec rule 2.7). */
    @Test
    fun `no state composables outside the page package`() {
        val stateFun = Regex("""@Composable\s+(?:internal\s+|private\s+)?fun\s+(\w*(?:Loading|Failure|Failed|Empty)\w*)\(""")
        // The pre-auth splash shown while the root view model resolves the session is registry-exempt.
        val allowed = setOf("LoadingScreen")
        val offenders = uiFiles().flatMap { f ->
            stateFun.findAll(f.readText()).map { "${f.name}: ${it.groupValues[1]}" }.filter { it.substringAfter(": ") !in allowed }.toList()
        }
        assertEquals("use PlayarrLoadingState / PlayarrEmptyState / PlayarrErrorState", emptyList<String>(), offenders)
    }

    /** Library, detail pages and playlist detail keep their header and Back while loading or failed (owner decision Q4). */
    @Test
    fun `the header stays up while loading and on error`() {
        fun body(file: String, marker: String, length: Int = 2600): String {
            val text = File(uiDir(), file).readText()
            return text.substring(text.indexOf(marker), minOf(text.length, text.indexOf(marker) + length))
        }
        listOf(
            Triple("PlayarrExperience.kt", "ExperienceLoad.Loading -> PlayarrPageLayout(\n            pageId = PlayarrPageId.Library,\n            header = playarrPageHeader(title = plural", 1200),
            Triple("PlayarrExperience.kt", "ExperienceLoad.Loading -> PlayarrPageLayout(\n            pageId = PlayarrPageId.Detail,\n            header = playarrPageHeader(title = \"\"", 1200),
            Triple("PlayarrParityScreens.kt", "ParityLoad.Loading -> PlayarrPageLayout(\n            pageId = PlayarrPageId.PlaylistDetail,\n            header = playarrPageHeader(title = \"\"", 1200),
        ).forEach { (file, marker, length) ->
            val text = body(file, marker, length)
            assertTrue("$file $marker: loading and failure are states inside the page layout", Regex("""PlayarrPageLayout\(""").findAll(text).count() >= 2)
            assertEquals("$file $marker", true, text.contains("PlayarrPageState.Loading(") && text.contains("playarrErrorState("))
        }
    }

    /** The page start gutter is a token (`playarrPageMetrics(...).start`); the allow-list shrinks as pages migrate (A5, A6). */
    @Test
    fun `no page start literals in screens`() {
        val allowed = emptySet<String>()
        val offenders = uiFiles().filter { it.name !in allowed }.filter { Regex("""\b154\.dp\b""").containsMatchIn(it.readText()) }.map { it.name }
        assertEquals("read the gutter from playarrPageMetrics()", emptyList<String>(), offenders)
    }

    /** Every page renders through the page layout and names its registry id (the legacy id and the scaffold adapter are gone). */
    @Test
    fun `every page layout call names its page and the scaffold adapter is gone`() {
        val offenders = uiFiles().flatMap { f ->
            Regex("""PlayarrPageLayout\((?!\s*pageId)""").findAll(f.readText()).map { "${f.name}@${it.range.first}" }.toList()
        }
        assertEquals("pass pageId = PlayarrPageId.<page>", emptyList<String>(), offenders)
        assertEquals("PlayarrPageScaffold is deleted", emptyList<String>(), uiFiles().filter { Regex("""PlayarrPageScaffold\(""").containsMatchIn(it.readText()) }.map { it.name })
        val registry = uiFiles().flatMap { f -> Regex("""PlayarrPageId\.(\w+)""").findAll(f.readText()).map { it.groupValues[1] }.toList() }.toSet()
        assertTrue("Library, Search, Detail, Calendar and Settings are registered: $registry", registry.containsAll(listOf("Library", "Search", "Detail", "Calendar", "Settings")))
    }
}
