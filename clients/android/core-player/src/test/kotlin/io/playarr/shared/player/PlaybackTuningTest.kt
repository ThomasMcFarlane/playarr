package io.playarr.shared.player

import androidx.media3.common.Player
import org.junit.Assert.assertEquals
import org.junit.Test

class PlaybackTuningTest {
    @Test
    fun targetBufferIsFortyPercentOfHeapClassWithinClamps() {
        val mb = 1024 * 1024
        assertEquals(48 * mb, ExoPlayerPlayarrPlayer.targetBufferBytes(64))
        assertEquals(214_748_364, ExoPlayerPlayarrPlayer.targetBufferBytes(512))
        assertEquals(256 * mb, ExoPlayerPlayarrPlayer.targetBufferBytes(4096))
    }

    @Test
    fun rebufferTrackerIgnoresInitialBufferingAndSeeks() {
        val tracker = RebufferTracker()
        tracker.onState(Player.STATE_BUFFERING, 0)
        tracker.onState(Player.STATE_READY, 1_000)
        tracker.onSeek()
        tracker.onState(Player.STATE_BUFFERING, 2_000)
        tracker.onState(Player.STATE_READY, 2_500)
        assertEquals(0, tracker.count)
        tracker.onState(Player.STATE_BUFFERING, 10_000)
        assertEquals(1, tracker.count)
        assertEquals(300, tracker.totalMs(10_300))
        tracker.onState(Player.STATE_READY, 10_400)
        assertEquals(400, tracker.totalMs(99_999))
    }

    @Test
    fun newItemBufferingAfterAnEndedItemIsNotARebuffer() {
        val tracker = RebufferTracker()
        tracker.onState(Player.STATE_BUFFERING, 0)
        tracker.onState(Player.STATE_READY, 1_000)
        tracker.onState(Player.STATE_ENDED, 50_000)
        // Autoplay next: reprepare with replace_item, then initial buffering.
        tracker.onNewItem(60_000)
        tracker.onState(Player.STATE_BUFFERING, 60_100)
        tracker.onState(Player.STATE_READY, 69_500)
        assertEquals(0, tracker.count)
        assertEquals(0, tracker.totalMs(70_000))
        // A real stall in the new item still counts.
        tracker.onState(Player.STATE_BUFFERING, 80_000)
        assertEquals(1, tracker.count)
    }

    @Test
    fun statsLineIsStableKeyValue() {
        val line = PlaybackStatsSnapshot(
            "tick", "ready", 1, 2, 3, 4, 5, 6, "dec", "hvc1", "3840x2160", 7, 4,
        ).toLogLine()
        assertEquals(
            "event=tick state=ready position_ms=1 buffered_ahead_ms=2 bandwidth_bps=3 rebuffer_count=4 " +
                "rebuffer_ms=5 dropped_frames=6 decoder=dec video_codec=hvc1 video_size=3840x2160 " +
                "video_bitrate=7 connections=4 seek_count=0 bytes_loaded=0 bitrate_source=unknown bandwidth_source=meter",
            line,
        )
    }

    @Test
    fun statsLineAppendsSeekCountAndBytesLoaded() {
        val line = PlaybackStatsSnapshot(
            "tick", "ready", 1, 2, 3, 4, 5, 6, "dec", "hvc1", "3840x2160", 7, 4, seekCount = 9, bytesLoaded = 1234,
        ).toLogLine()
        assertEquals(true, line.contains(" seek_count=9 bytes_loaded=1234 "))
    }

    @Test
    fun seekTrackerReportsLatencyOnceAndRestartsOnSupersededSeek() {
        val tracker = SeekTracker()
        assertEquals(null, tracker.onReady(100))
        tracker.onSeek(5_000, 1_000)
        tracker.onSeek(9_000, 1_200)
        assertEquals(2, tracker.count)
        assertEquals(9_000L to 800L, tracker.onReady(2_000))
        assertEquals(null, tracker.onReady(2_500))
    }

    @Test
    fun backBufferKeepsThirtySecondsForOrdinaryContentAndShrinksForRemuxes() {
        val budget = ExoPlayerPlayarrPlayer.backBufferBudgetBytes(512)
        // 8 Mbps: 30 s is ~30 MB, well inside a ~70 MB budget.
        assertEquals(30_000_000L, SeekBufferPolicy.backBufferUs(budget, 8_000_000L))
        // 62 Mbps remux: bounded by the byte budget, not 30 s.
        val remux = SeekBufferPolicy.backBufferUs(budget, 62_000_000L)
        assertEquals(true, remux in 1 until 30_000_000L)
        assertEquals(true, remux * 62_000_000L / 8 / 1_000_000L <= budget)
        // Unknown bitrate assumes the worst case instead of the full 30 s.
        assertEquals(true, SeekBufferPolicy.backBufferUs(budget, 0) <= remux)
        assertEquals(0L, SeekBufferPolicy.backBufferUs(0, 8_000_000L))
        assertEquals(true, budget <= ExoPlayerPlayarrPlayer.targetBufferBytes(512) / 3)
    }

    @Test
    fun fastPostSeekStartNeedsHeadroomAndNeverAppliesToInitialStartOrRebuffer() {
        val us = SeekBufferPolicy.FAST_START_US
        val bitrate = 62_000_000L
        assertEquals(us, SeekBufferPolicy.startThresholdUs(false, true, bitrate, bitrate * 2))
        assertEquals(SeekBufferPolicy.MEDIUM_START_US, SeekBufferPolicy.startThresholdUs(false, true, bitrate, bitrate * 2 - 1))
        assertEquals(null, SeekBufferPolicy.startThresholdUs(false, false, bitrate, bitrate * 5))
        assertEquals(null, SeekBufferPolicy.startThresholdUs(true, true, bitrate, bitrate * 5))
        assertEquals(null, SeekBufferPolicy.startThresholdUs(false, true, 0, bitrate * 5))
        assertEquals(null, SeekBufferPolicy.startThresholdUs(false, true, bitrate, 0))
    }

    @Test
    fun bitrateFallsBackToDerivedWhenTheTracksDeclareNone() {
        assertEquals(ResolvedBitrate(8_000_000L, BitrateSource.DECLARED), StreamBitrate.resolve(8_000_000L, 62_000_000L))
        assertEquals(ResolvedBitrate(62_000_000L, BitrateSource.DERIVED), StreamBitrate.resolve(0, 62_000_000L))
        assertEquals(ResolvedBitrate(0L, BitrateSource.UNKNOWN), StreamBitrate.resolve(0, 0))
        val format = androidx.media3.common.Format.Builder().build()
        assertEquals(0L, StreamBitrate.declaredBps(format))
    }

    @Test
    fun fieldCaseFastStartActivatesWithDerivedBitrateAndAggregateThroughput() {
        // MKV: no declared bitrate, 62 Mbps derived; link ~160 Mbps, meter ~5.4 Mbps.
        val derived = StreamBitrate.resolve(0, 62_000_000L).bps
        assertEquals(null, SeekBufferPolicy.startThresholdUs(false, true, 0, 160_000_000L))
        assertEquals(null, SeekBufferPolicy.startThresholdUs(false, true, derived, 5_400_000L))
        assertEquals(SeekBufferPolicy.FAST_START_US, SeekBufferPolicy.startThresholdUs(false, true, derived, 160_000_000L))
    }

    @Test
    fun postSeekThresholdScalesWithHeadroomAtExactBoundaries() {
        val b = 10_000_000L
        fun t(thr: Long) = SeekBufferPolicy.startThresholdUs(false, true, b, thr)
        assertEquals(3_000_000L, t(20_000_000L))
        assertEquals(4_000_000L, t(19_999_999L))
        assertEquals(4_000_000L, t(15_000_000L))
        assertEquals(5_000_000L, t(14_999_999L))
        assertEquals(5_000_000L, t(12_000_000L))
        assertEquals(null, t(11_999_999L))
        assertEquals(null, t(0))
    }

    @Test
    fun recentRebufferForcesDefaultThresholdUntilGuardExpires() {
        val b = 10_000_000L
        fun t(since: Long) = SeekBufferPolicy.startThresholdUs(false, true, b, b * 3, since)
        assertEquals(null, t(0))
        assertEquals(null, t(59_999))
        assertEquals(3_000_000L, t(60_000))
        assertEquals(3_000_000L, t(Long.MAX_VALUE))
    }
}
