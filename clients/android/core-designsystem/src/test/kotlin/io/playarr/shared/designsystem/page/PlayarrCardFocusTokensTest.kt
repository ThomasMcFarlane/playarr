package io.playarr.shared.designsystem.page

import androidx.compose.ui.unit.dp
import org.junit.Assert.assertEquals
import org.junit.Test

/** The card focus values are the ones pinned in docs/design/page-layout.md section 5 item 1a (web PR #232). */
class PlayarrCardFocusTokensTest {
    @Test
    fun motionsMatchTheWebCardFocus() {
        assertEquals(7.dp, PlayarrCardMotions.Card.lift)
        assertEquals(6.dp, PlayarrCardMotions.Home.lift)
        assertEquals(5.dp, PlayarrCardMotions.Library.lift)
        assertEquals(1.015f, PlayarrCardMotions.Library.scale, 0f)
        assertEquals(6.dp, PlayarrCardMotions.Search.lift)
        assertEquals(1.015f, PlayarrCardMotions.Search.scale, 0f)
        assertEquals(listOf(260, 260, 260, 230), listOf(PlayarrCardMotions.Card, PlayarrCardMotions.Home, PlayarrCardMotions.Library, PlayarrCardMotions.Search).map { it.durationMs })
        assertEquals(1.025f, PlayarrCardMotions.ArtScale, 0f)
        assertEquals(240, PlayarrCardMotions.ArtDurationMs)
    }

    @Test
    fun shadowsMatchTheWebCardFocus() {
        assertEquals(listOf(24.dp to 48.dp, 10.dp to 20.dp), PlayarrCardShadows.Focused.map { it.offsetY to it.blur })
        assertEquals(listOf(26.dp to 52.dp, 11.dp to 22.dp), PlayarrCardShadows.FocusedHome.map { it.offsetY to it.blur })
        assertEquals(listOf(22.dp to 52.dp), PlayarrCardShadows.FocusedSearch.map { it.offsetY to it.blur })
        assertEquals(listOf(10.dp to 20.dp, 3.dp to 8.dp), PlayarrCardShadows.Rest.map { it.offsetY to it.blur })
        assertEquals(listOf(30, 20), PlayarrCardShadows.Focused.map { Math.round(it.color.alpha * 100) })
    }
}
