package io.playarr.mobile.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.focusable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.lazy.grid.rememberLazyGridState
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.assertTextContains
import androidx.compose.ui.test.captureToImage
import androidx.compose.ui.test.isFocused
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performKeyInput
import androidx.compose.ui.test.pressKey
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.graphics.asAndroidBitmap
import io.playarr.shared.data.model.Availability
import io.playarr.shared.data.model.Episode
import io.playarr.shared.data.model.EpisodeDetail
import io.playarr.shared.data.model.Season
import io.playarr.shared.data.model.SeasonDetail
import io.playarr.shared.data.model.WorkCreditsResponse
import io.playarr.shared.data.model.Work
import io.playarr.shared.data.model.WorkKind
import java.time.Instant
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

/**
 * D-pad navigation on the television layouts, driven by key events. The harnesses compose the same rail, grid and
 * episode-track composables and the same navigators as Home, Movies/Series and the series page, and assert which
 * item holds focus after every press.
 */
@OptIn(ExperimentalTestApi::class)
class PlayarrTvNavigationUiTest {
    @get:Rule
    val compose = createComposeRule()

    private var focused by mutableStateOf("")
    private var navFocused by mutableStateOf(false)

    private fun work(id: String) = Work(
        id = id, kind = WorkKind.Movie, title = id, sortTitle = id,
        addedAt = Instant.parse("2026-01-01T00:00:00Z"), monitored = true, availability = Availability.Available,
    )

    private fun press(vararg keys: Long): List<String> = keys.map { code ->
        val key = Key(code)
        compose.onRoot().performKeyInput { pressKey(key) }
        compose.waitForIdle()
        focused
    }

    /** Home: a column of rails of the sizes given, a navigation-rail stand-in on the left, focus starting on the first card. */
    private fun setHome(sizes: List<Int>) {
        val homeRails = sizes.mapIndexed { r, n ->
            HomeRail(title = null, works = (0 until n).map { work("r$r-c$it") }, literalTitle = "Rail $r", railId = "r$r")
        }
        compose.setContent {
            val scope = rememberCoroutineScope()
            val rails = remember { TvRails(scope, TvRails.Vertical.SameIndex) }
            val column = rememberLazyListState()
            val nav = remember { FocusRequester() }
            rails.sizes = sizes
            rails.columnState = column
            rails.onLeftEdge = { nav.requestFocus(); true }
            Row(Modifier.fillMaxSize()) {
                Box(Modifier.size(64.dp).focusRequester(nav).onFocusChanged { navFocused = it.isFocused; if (it.isFocused) focused = "nav" }.focusable())
                LazyColumn(
                    state = column, modifier = Modifier.fillMaxSize(),
                    contentPadding = PaddingValues(top = 120.dp), verticalArrangement = Arrangement.spacedBy(78.dp),
                ) {
                    itemsIndexed(homeRails, key = { _, rail -> rail.key }) { railIndex, rail ->
                        ExperienceMediaRail(
                            rail = rail, serverUrl = "http://localhost", accessToken = null, isTelevision = true,
                            homeView = PlayarrHomeViewPreference.Thumbnail, selectedId = focused, progressByWork = emptyMap(),
                            onSelected = { focused = it.id }, onClick = { _, _ -> }, onContext = {},
                            rails = rails, railIndex = railIndex,
                        )
                    }
                }
            }
            LaunchedEffect(Unit) { rails.focus(0, 0) }
        }
        compose.waitUntil(10_000) { focused.isNotEmpty() }
        compose.waitForIdle()
    }

    @Test
    fun homeOpensOnTheFirstCard() {
        setHome(listOf(5, 3, 3))
        assertEquals("r0-c0", focused)
    }

    @Test
    fun repeatedDownOnHomeMovesDownThroughTheRailsNeverSideways() {
        setHome(listOf(5, 3, 4, 2))
        // The reported regression: DOWN bounced between the first two cards of the first rail, forever.
        val seen = press(Key.DirectionDown.keyCode, Key.DirectionDown.keyCode, Key.DirectionDown.keyCode, Key.DirectionDown.keyCode, Key.DirectionDown.keyCode)
        assertEquals(listOf("r1-c0", "r2-c0", "r3-c0", "r3-c0", "r3-c0"), seen)
        val back = press(Key.DirectionUp.keyCode, Key.DirectionUp.keyCode, Key.DirectionUp.keyCode, Key.DirectionUp.keyCode)
        assertEquals(listOf("r2-c0", "r1-c0", "r0-c0", "r0-c0"), back)
    }

    @Test
    fun downKeepsTheCardColumnAndClampsToAShorterRail() {
        setHome(listOf(5, 3, 5))
        press(Key.DirectionRight.keyCode, Key.DirectionRight.keyCode, Key.DirectionRight.keyCode, Key.DirectionRight.keyCode)
        assertEquals("r0-c4", focused)
        assertEquals(listOf("r1-c2", "r2-c2"), press(Key.DirectionDown.keyCode, Key.DirectionDown.keyCode))
        assertEquals(listOf("r1-c2", "r0-c2"), press(Key.DirectionUp.keyCode, Key.DirectionUp.keyCode))
    }

    @Test
    fun rightStopsAtTheEndOfARailAndLeftAtTheStartGoesToTheNavigationRail() {
        setHome(listOf(3, 3))
        assertEquals(listOf("r0-c1", "r0-c2", "r0-c2", "r0-c2"), press(Key.DirectionRight.keyCode, Key.DirectionRight.keyCode, Key.DirectionRight.keyCode, Key.DirectionRight.keyCode))
        assertEquals(listOf("r0-c1", "r0-c0", "nav"), press(Key.DirectionLeft.keyCode, Key.DirectionLeft.keyCode, Key.DirectionLeft.keyCode))
        assertTrue(navFocused)
    }

    @Test
    fun aLongRailScrollsToTheNextCardAndFocusesIt() {
        setHome(listOf(30, 30))
        val path = press(*LongArray(25) { Key.DirectionRight.keyCode })
        assertEquals("r0-c25", path.last())
        assertEquals("r1-c25", press(Key.DirectionDown.keyCode).single())
    }

    /** Movies and Series: three columns, seven titles. */
    private fun setGrid(onRight: () -> Unit, onLeft: () -> Unit) {
        val works = (0 until 7).map { work("g$it") }
        compose.setContent {
            val scope = rememberCoroutineScope()
            val grid = remember { TvGrid(scope) }
            grid.onLeftEdge = { onLeft(); true }
            grid.onRightEdge = { onRight(); true }
            LibraryResults(
                works = works, viewMode = LibraryViewMode.Screen, artworkSize = LibraryArtworkSize.Medium,
                serverUrl = "http://localhost", accessToken = null, isTelevision = true, selectedId = focused,
                progressByWork = emptyMap(), progressLoaded = true,
                onSelected = { focused = it.id }, onOpen = {}, onContext = {},
                grid = grid, gridState = rememberLazyGridState(),
            )
            LaunchedEffect(Unit) { grid.focus(0, 0) }
        }
        compose.waitUntil(10_000) { focused.isNotEmpty() }
        compose.waitForIdle()
    }

    @Test
    fun libraryGridFollowsTheWebTitleGrid() {
        var right = 0
        var left = 0
        setGrid(onRight = { right += 1 }, onLeft = { left += 1 })
        assertEquals("g0", focused)
        assertEquals(listOf("g1", "g2"), press(Key.DirectionRight.keyCode, Key.DirectionRight.keyCode))
        // RIGHT in the last column leaves for the alphabet strip, focus stays on the card meanwhile.
        press(Key.DirectionRight.keyCode)
        assertEquals(1, right)
        assertEquals(listOf("g5", "g6", "g6"), press(Key.DirectionDown.keyCode, Key.DirectionDown.keyCode, Key.DirectionDown.keyCode))
        assertEquals(listOf("g3", "g0"), press(Key.DirectionUp.keyCode, Key.DirectionUp.keyCode))
        press(Key.DirectionLeft.keyCode)
        assertEquals(1, left)
    }

    private fun episode(id: String, number: Int) = EpisodeDetail(
        Episode(id = id, seasonId = "s", episodeNumber = number, title = "Title $id", monitored = true, availability = Availability.Available),
        mediaFileId = "media-$id",
    )

    private fun season(number: Int, count: Int) = SeasonDetail(
        Season(id = "season-$number", seriesWorkId = "series", seasonNumber = number, monitored = true, availability = Availability.Available),
        (1..count).map { episode("e$number$it", it) },
    )

    private fun setSeries(focusEpisodeId: String, playFocus: FocusRequester) {
        val seasons = listOf(season(1, 3), season(2, 2), season(3, 12))
        compose.setContent {
            SeriesEpisodeBrowser(
                seasons = seasons, selectedEpisodeId = focusEpisodeId, work = work("series"),
                progressByMedia = emptyMap(), serverUrl = "http://localhost", accessToken = null,
                isTelevision = true, canDownload = false, onSelect = { e, _ -> focused = e.episode.id }, onPlay = {},
                onDownload = {}, credits = WorkCreditsResponse(), similarWorks = emptyList(), onOpenWork = {},
                focusEpisodeId = focusEpisodeId, playFocus = playFocus,
                modifier = Modifier.fillMaxSize(),
            )
            Box(Modifier.size(1.dp).focusRequester(playFocus).onFocusChanged { if (it.isFocused) focused = "play" }.focusable())
        }
        compose.waitUntil(10_000) { focused.isNotEmpty() }
        compose.waitForIdle()
    }

    @Test
    fun aSeriesPageOpensOnTheNextUpEpisodeEvenWhenItsSeasonIsOffScreen() {
        setSeries("e39", FocusRequester())
        compose.onNode(isFocused()).assertTextContains("Title e39", substring = true)
        assertEquals("e39", focused)
    }

    @Test
    fun aSeriesPageOpensOnTheFirstEpisodeWhenNothingWasWatched() {
        setSeries("e11", FocusRequester())
        assertEquals("e11", focused)
    }

    @Test
    fun seasonTracksMoveToTheClosestTileAndLeftFromTheFirstTileGoesToPlay() {
        setSeries("e13", FocusRequester())
        // DOWN from the third tile of season 1 lands on the closest tile of the two-episode season 2, then season 3.
        assertEquals(listOf("e22", "e32"), press(Key.DirectionDown.keyCode, Key.DirectionDown.keyCode))
        assertEquals(listOf("e22", "e12"), press(Key.DirectionUp.keyCode, Key.DirectionUp.keyCode))
        assertEquals(listOf("e11", "play"), press(Key.DirectionLeft.keyCode, Key.DirectionLeft.keyCode))
    }

    @Test
    fun theFocusRingIsDrawnWithoutAnyFillInTheDarkTheme() = assertRingWithoutFill(dark = true)

    @Test
    fun theFocusRingIsDrawnWithoutAnyFillInTheLightTheme() = assertRingWithoutFill(dark = false)

    private fun assertRingWithoutFill(dark: Boolean) {
        run {
            setPlayarrWebPalette(dark)
            val ring = WebCardFocusRing.toArgb()
            val requester = FocusRequester()
            compose.setContent {
                // Television installs no Material indication (MainActivity), so a focused clickable draws no fill.
                androidx.compose.runtime.CompositionLocalProvider(
                    androidx.compose.foundation.LocalIndication provides io.playarr.shared.designsystem.component.PlayarrNoIndication,
                ) {
                    Box(Modifier.testTag("card").background(WebBackground).padding(16.dp)) {
                        ExperienceLandscapeCard(
                            work = work("ring"), serverUrl = "http://localhost", accessToken = null, width = 219.dp,
                            selected = false, onSelected = {}, onClick = {},
                            modifier = Modifier.focusRequester(requester),
                            webTvStyle = true,
                        )
                    }
                }
            }
            compose.waitForIdle()
            val before = compose.onNodeWithTag("card").captureToImage().asAndroidBitmap()
            compose.waitUntil(10_000) { runCatching { compose.runOnIdle { requester.requestFocus() } }.getOrDefault(false) }
            compose.waitForIdle()
            val after = compose.onNodeWithTag("card").captureToImage().asAndroidBitmap()
            val density = compose.density
            val edge = with(density) { 16.dp.roundToPx() }
            val ringX = edge - with(density) { 1.5.dp.roundToPx() }
            val midY = edge + with(density) { 60.dp.roundToPx() }
            assertTrue("ring colour on focus (dark=$dark)", channelsNear(after.getPixel(ringX, midY), ring))
            assertFalse("no ring before focus (dark=$dark)", channelsNear(before.getPixel(ringX, midY), ring))
            // No fill: the art's interior is pixel-identical before and after focus.
            for ((x, y) in listOf(edge + 40 to edge + 20, edge + 100 to edge + 70)) {
                assertEquals("interior unchanged at $x,$y (dark=$dark)", before.getPixel(x, y), after.getPixel(x, y))
            }
        }
        setPlayarrWebPalette(true)
    }

    private fun channelsNear(argb: Int, ring: Int, tolerance: Int = 16): Boolean =
        listOf(16, 8, 0).all { shift -> kotlin.math.abs(((argb shr shift) and 0xFF) - ((ring shr shift) and 0xFF)) <= tolerance }
}
