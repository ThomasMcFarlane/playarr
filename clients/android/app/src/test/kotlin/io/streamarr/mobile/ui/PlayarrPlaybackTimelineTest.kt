package io.streamarr.mobile.ui

import org.junit.Assert.assertEquals
import org.junit.Test

class PlayarrPlaybackTimelineTest {
    @Test
    fun `on demand source offsets map between source and Media3 time`() {
        assertEquals(0L, playarrEnginePositionMs(1_200_000L, 1_200_000L))
        assertEquals(30_000L, playarrEnginePositionMs(1_230_000L, 1_200_000L))
        assertEquals(1_230_000L, playarrSourcePositionMs(30_000L, 1_200_000L, 7_200_000L))
    }

    @Test
    fun `direct sources retain their native timeline and clamp at duration`() {
        assertEquals(45_000L, playarrEnginePositionMs(45_000L, 0L))
        assertEquals(45_000L, playarrSourcePositionMs(45_000L, 0L, 90_000L))
        assertEquals(90_000L, playarrSourcePositionMs(100_000L, 0L, 90_000L))
    }
}
