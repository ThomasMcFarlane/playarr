package io.playarr.mobile.ui

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

    @Test
    fun `player time matches the web controller clock`() {
        assertEquals("0:00", formatPlayarrPlayerTime(-1L))
        assertEquals("9:08", formatPlayarrPlayerTime(548_999L))
        assertEquals("1:01:01", formatPlayarrPlayerTime(3_661_000L))
    }

    @Test
    fun `minimised player progress matches the web rail and stays bounded`() {
        assertEquals(0f, playarrPlaybackProgress(5_000L, 0L))
        assertEquals(0f, playarrPlaybackProgress(-1_000L, 10_000L))
        assertEquals(0.25f, playarrPlaybackProgress(2_500L, 10_000L))
        assertEquals(1f, playarrPlaybackProgress(12_000L, 10_000L))
    }

    @Test
    fun `on demand session urls use source renegotiation for seeks`() {
        assertEquals(true, isPlayarrOnDemandHls("/api/v1/media/sessions/s1/playlist.m3u8"))
        assertEquals(false, isPlayarrOnDemandHls("/api/v1/media/mf-1/content"))
    }

    @Test
    fun `only expired on demand manifests trigger automatic recovery`() {
        val sessionUrl = "https://playarr.example/api/v1/media/sessions/s1/playlist.m3u8"

        assertEquals(true, shouldRecoverPlayarrHlsSession(true, 404, sessionUrl))
        assertEquals(false, shouldRecoverPlayarrHlsSession(true, 500, sessionUrl))
        assertEquals(false, shouldRecoverPlayarrHlsSession(false, 404, sessionUrl))
        assertEquals(false, shouldRecoverPlayarrHlsSession(true, 404, "https://playarr.example/media.mp4"))
    }
}
