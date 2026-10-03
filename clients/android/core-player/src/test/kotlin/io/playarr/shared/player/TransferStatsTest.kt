package io.playarr.shared.player

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class TransferStatsTest {
    private var now = 0L
    private val stats = TransferStats { now }

    @Test
    fun throughputIsAggregateBytesOverTimeWithAChunkActive() {
        stats.onChunkStarted()
        stats.onChunkStarted()
        repeat(10) {
            now += 100
            stats.onBytes(1_000_000)
        }
        stats.onChunkEnded()
        stats.onChunkEnded()
        // 10 MB in 1 s = 80 Mbps.
        assertEquals(80_000_000L, stats.throughputBps())
        assertEquals(10_000_000L, stats.totalBytes())
    }

    @Test
    fun idleTimeWithNothingInFlightDoesNotDiluteTheEstimate() {
        stats.onChunkStarted()
        repeat(8) {
            now += 100
            stats.onBytes(2_000_000)
        }
        stats.onChunkEnded()
        val busy = stats.throughputBps()
        assertEquals(160_000_000L, busy)
        // Reader throttled by a full buffer: no chunk active for a minute.
        now += 60_000
        assertEquals(busy, stats.throughputBps())
    }

    @Test
    fun estimateIsZeroBeforeAnyMeasurementAndUsesPartialSampleEarly() {
        assertEquals(0L, stats.throughputBps())
        stats.onChunkStarted()
        now += 150
        stats.onBytes(300_000)
        assertEquals(16_000_000L, stats.throughputBps())
    }

    @Test
    fun deriveBitrateFromContentLengthAndDuration() {
        assertEquals(0L, stats.derivedBitrateBps())
        stats.setCurrentStream("https://h/stream", 3_600_000)
        assertEquals(0L, stats.derivedBitrateBps()) // length unknown
        stats.recordContentLength("https://h/stream", 27_900_000_000L)
        // 27.9 GB over one hour = 62 Mbps.
        assertEquals(62_000_000L, stats.derivedBitrateBps())
        stats.setCurrentStream("https://h/stream", -1)
        assertEquals(0L, stats.derivedBitrateBps())
        stats.setCurrentStream("https://h/other", 3_600_000)
        assertEquals(0L, stats.derivedBitrateBps())
        assertNull(stats.contentLength("https://h/unknown"))
    }

    @Test
    fun remembersAtMostAFewUris() {
        repeat(20) { stats.recordContentLength("u$it", 100L + it) }
        assertNull(stats.contentLength("u0"))
        assertEquals(119L, stats.contentLength("u19"))
    }
}
