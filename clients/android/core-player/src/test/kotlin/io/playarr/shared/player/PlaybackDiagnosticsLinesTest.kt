package io.playarr.shared.player

import org.junit.Assert.assertEquals
import org.junit.Test

class PlaybackDiagnosticsLinesTest {
    @Test
    fun reprepareLineCarriesReasonAndBufferState() {
        assertEquals(
            "event=reprepare reason=replace_item state=ready position_ms=5 buffered_ahead_ms=16000",
            PlaybackStatsLogger.reprepareLine("replace_item", "ready", 5, 16_000),
        )
    }

    @Test
    fun surfaceLineFlagsDetach() {
        assertEquals(
            "event=surface width=0 height=0 attached=false state=ready position_ms=5 buffered_ahead_ms=16000",
            PlaybackStatsLogger.surfaceLine(0, 0, "ready", 5, 16_000),
        )
    }
}
