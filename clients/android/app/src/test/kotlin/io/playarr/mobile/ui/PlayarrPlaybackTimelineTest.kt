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

    @Test
    fun `undecodable direct play falls back to a transcode once`() {
        assertEquals(true, shouldFallBackToTranscodeAfterDecodeFailure(true, "ERROR_CODE_DECODING_FAILED", false))
        assertEquals(true, shouldFallBackToTranscodeAfterDecodeFailure(true, "ERROR_CODE_DECODING_FORMAT_EXCEEDS_CAPABILITIES", false))
        assertEquals(false, shouldFallBackToTranscodeAfterDecodeFailure(true, "ERROR_CODE_DECODING_FAILED", true))
        assertEquals(false, shouldFallBackToTranscodeAfterDecodeFailure(false, "ERROR_CODE_DECODING_FAILED", false))
        // An original-quality HLS session with copied video (activeDirectPlay=false) still falls back;
        // a forced transcode (any other quality) does not.
        val copied = playarrPlaysSourceVideo(activeDirectPlay = false, activeQualityId = "original")
        assertEquals(true, shouldFallBackToTranscodeAfterDecodeFailure(copied, "ERROR_CODE_DECODING_FAILED", false))
        assertEquals(false, playarrPlaysSourceVideo(activeDirectPlay = false, activeQualityId = DECODE_FALLBACK_PROFILE))
        assertEquals(true, playarrPlaysSourceVideo(activeDirectPlay = true, activeQualityId = null))
        assertEquals(
            true,
            java.io.File("src/main/kotlin/io/playarr/mobile/ui/PlayarrExperience.kt").readText()
                .contains("playarrPlaysSourceVideo(activeDirectPlay, _controls.value.activeQualityId)"),
        )
        assertEquals(false, shouldFallBackToTranscodeAfterDecodeFailure(true, "ERROR_CODE_IO_NETWORK_CONNECTION_FAILED", false))
    }

    @Test
    fun `mini player timeline uses the source window after a seek on a large mp4`() {
        // Row 102: engine window after a seek reported ~0:10, source is 1:34:51 with the seek at 1:33:55.
        val sourceDuration = 5_691_000L
        val offset = 5_635_000L
        val engineWindow = 10_000L
        val duration = playarrSourceDurationMs(sourceDuration, engineWindow, offset)
        val position = playarrSourcePositionMs(0L, offset, duration)
        assertEquals("1:34:51", formatPlayarrPlayerTime(duration))
        assertEquals("1:33:55", formatPlayarrPlayerTime(position))
        assertEquals("0:10", formatPlayarrPlayerTime(engineWindow))
    }

    @Test
    fun `source duration falls back to the offset engine window then zero`() {
        assertEquals(1_210_000L, playarrSourceDurationMs(0L, 10_000L, 1_200_000L))
        assertEquals(0L, playarrSourceDurationMs(0L, -1L, 1_200_000L))
        assertEquals(500L, playarrSourceDurationMs(500L, 10_000L, 1_200_000L))
    }
}
