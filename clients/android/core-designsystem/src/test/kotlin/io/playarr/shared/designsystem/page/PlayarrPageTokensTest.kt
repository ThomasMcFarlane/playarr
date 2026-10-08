package io.playarr.shared.designsystem.page

import androidx.compose.ui.unit.dp
import org.junit.Assert.assertEquals
import org.junit.Test

/** Pins the page chrome measurements to docs/design/page-layout.md section 3. */
class PlayarrPageTokensTest {
    @Test
    fun televisionTokensMatchTheSpec() {
        val tv = PlayarrPageTokens.of(PlayarrFormFactor.Tv)
        assertEquals(56.dp, tv.headerTop)
        assertEquals(154.dp, tv.start)
        assertEquals(76.8.dp, tv.headerEnd)
        assertEquals(50.dp, tv.control)
        assertEquals(62.dp, tv.pillWidth)
        assertEquals(72.dp, tv.pillHeight)
        assertEquals(14.dp, tv.pillRadius)
        assertEquals(23.dp, tv.headerGap)
        assertEquals(96.dp, tv.safeBottom)
        assertEquals(3.dp, tv.focusRingWidth)
        assertEquals(2.dp, tv.focusRingOffset)
    }

    @Test
    fun phoneTokensMatchTheSpec() {
        val phone = PlayarrPageTokens.of(PlayarrFormFactor.Phone)
        assertEquals(2.dp, phone.headerTop)
        assertEquals(16.dp, phone.start)
        assertEquals(72.dp, phone.headerEnd)
        assertEquals(16.dp, phone.bodyEnd)
        assertEquals(38.dp, phone.control)
        assertEquals(44.dp, phone.pillWidth)
        assertEquals(44.dp, phone.pillHeight)
        assertEquals(72.dp, phone.safeBottom)
        assertEquals(2.dp, phone.focusRingWidth)
        assertEquals(3.dp, phone.focusRingOffset)
    }

    @Test
    fun theHeaderRowGrowsToTheTile() {
        assertEquals(72.dp, PlayarrPageTokens.Tv.headerHeight)
        assertEquals(44.dp, PlayarrPageTokens.Phone.headerHeight)
    }
}
