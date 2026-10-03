package io.playarr.shared.player

import android.net.Uri
import androidx.media3.common.C
import androidx.media3.datasource.DataSource
import androidx.media3.datasource.DataSpec
import androidx.media3.datasource.okhttp.OkHttpDataSource
import java.io.IOException
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicInteger
import okhttp3.OkHttpClient
import okhttp3.Protocol
import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import okio.Buffer
import org.junit.After
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Test

class ParallelRangeDataSourceTest {
    private val data = ByteArray(10_000) { (it * 31 + it / 7).toByte() }
    private val server = MockWebServer()
    private val executor = Executors.newCachedThreadPool { Thread(it).apply { isDaemon = true } }
    private val stats = TransferStats()
    private val client = OkHttpClient.Builder().protocols(listOf(Protocol.HTTP_1_1)).build()

    // Behaviour knobs for the fake range server.
    @Volatile private var supportRanges = true

    @Volatile private var delayMs: (Long) -> Long = { 0L }

    // When set, response bodies trickle at this many bytes per second.
    @Volatile private var throttleBytesPerSec: Long = 0L
    private val rangeHeaders = java.util.Collections.synchronizedList(mutableListOf<String>())
    private val failuresLeft = ConcurrentHashMap<Long, AtomicInteger>()
    private val concurrent = AtomicInteger()
    private val maxConcurrent = AtomicInteger()
    private val requestCount = AtomicInteger()

    @Before
    fun setUp() {
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                requestCount.incrementAndGet()
                request.getHeader("Range")?.let { rangeHeaders.add(it) }
                val now = concurrent.incrementAndGet()
                maxConcurrent.accumulateAndGet(now, ::maxOf)
                try {
                    return respond(request)
                } finally {
                    concurrent.decrementAndGet()
                }
            }
        }
        server.start()
    }

    @After
    fun tearDown() {
        server.shutdown()
        executor.shutdownNow()
    }

    private fun respond(request: RecordedRequest): MockResponse {
        val range = request.getHeader("Range")?.let { Regex("bytes=(\\d+)-(\\d*)").matchEntire(it) }
        if (!supportRanges || range == null) {
            return MockResponse().setResponseCode(200).setBody(Buffer().write(data))
        }
        val start = range.groupValues[1].toLong()
        val end = minOf(range.groupValues[2].ifEmpty { "${data.size - 1}" }.toLong(), data.size - 1L)
        if (start >= data.size) return MockResponse().setResponseCode(416)
        failuresLeft[start]?.let { left ->
            if (left.getAndUpdate { if (it > 0) it - 1 else 0 } > 0) return MockResponse().setResponseCode(503)
        }
        val pause = delayMs(start)
        if (pause > 0) Thread.sleep(pause)
        return MockResponse()
            .setResponseCode(206)
            .addHeader("Content-Range", "bytes $start-$end/${data.size}")
            .setBody(Buffer().write(data, start.toInt(), (end - start + 1).toInt()))
            .apply { if (throttleBytesPerSec > 0) throttleBody(throttleBytesPerSec, 1, java.util.concurrent.TimeUnit.SECONDS) }
    }

    private fun awaitNoActiveConnections(timeoutMs: Long): Long {
        val started = System.nanoTime()
        val deadline = started + timeoutMs * 1_000_000L
        while (ParallelRangeDataSource.activeConnections > 0 && System.nanoTime() < deadline) Thread.sleep(5)
        return (System.nanoTime() - started) / 1_000_000
    }

    @Suppress("UNCHECKED_CAST")
    private fun ParallelRangeDataSource.windowSize(): Int {
        val field = ParallelRangeDataSource::class.java.getDeclaredField("window").apply { isAccessible = true }
        return (field.get(this) as java.util.ArrayDeque<*>).size
    }

    private fun newSource(
        concurrency: Int = 3,
        enabled: () -> Boolean = { true },
        attempts: Int = 3,
    ): ParallelRangeDataSource = ParallelRangeDataSource(
        client = client,
        fallback = OkHttpDataSource.Factory(client).createDataSource(),
        executor = executor,
        concurrency = concurrency,
        chunkBytes = 1_000,
        initialChunkBytes = 500,
        maxChunkAttempts = attempts,
        retryDelayMs = 10,
        isEnabled = enabled,
        stats = stats,
    )

    private fun spec(position: Long = 0, length: Long = C.LENGTH_UNSET.toLong()) = DataSpec.Builder()
        .setUri(Uri.parse(server.url("/api/v1/media/mf-1/stream").toString()))
        .setPosition(position)
        .setLength(length)
        .build()

    private fun DataSource.readFully(): ByteArray {
        val out = java.io.ByteArrayOutputStream()
        val buffer = ByteArray(333)
        while (true) {
            val n = read(buffer, 0, buffer.size)
            if (n == C.RESULT_END_OF_INPUT) break
            out.write(buffer, 0, n)
        }
        return out.toByteArray()
    }

    @Test
    fun deliversBytesInOrderWhenChunksCompleteOutOfOrder() {
        // Earlier chunks are slower than later ones, so completion order is reversed.
        delayMs = { start -> if (start == 0L) 0 else (10_000 - start) / 20 }
        val source = newSource(concurrency = 4)
        assertEquals(data.size.toLong(), source.open(spec()))
        assertArrayEquals(data, source.readFully())
        source.close()
    }

    @Test
    fun honoursPositionAndLength() {
        val source = newSource()
        assertEquals(3_000L, source.open(spec(position = 1_234, length = 3_000)))
        assertArrayEquals(data.copyOfRange(1_234, 4_234), source.readFully())
        source.close()
    }

    @Test
    fun reopenAfterSeekCancelsOutstandingChunksAndReadsNewPosition() {
        // Everything beyond the first chunk is slow, so close() must not wait for it.
        delayMs = { start -> if (start in 500 until 8_000) 4_000 else 0 }
        val source = newSource(concurrency = 3)
        source.open(spec())
        val head = ByteArray(100)
        assertEquals(100, source.read(head, 0, 100))
        val started = System.nanoTime()
        source.close()
        source.open(spec(position = 8_000))
        val tail = source.readFully()
        val elapsedMs = (System.nanoTime() - started) / 1_000_000
        assertArrayEquals(data.copyOfRange(8_000, data.size), tail)
        assertTrue("seek took ${elapsedMs}ms", elapsedMs < 2_000)
        source.close()
        val deadline = System.nanoTime() + 2_000_000_000L
        while (ParallelRangeDataSource.activeConnections > 0 && System.nanoTime() < deadline) Thread.sleep(10)
        assertEquals(0, ParallelRangeDataSource.activeConnections)
    }

    @Test
    fun fallsBackToSingleConnectionWhenServerIgnoresRanges() {
        supportRanges = false
        val source = newSource()
        source.open(spec())
        assertArrayEquals(data, source.readFully())
        source.close()
        source.open(spec(position = 2_500))
        assertArrayEquals(data.copyOfRange(2_500, data.size), source.readFully())
        source.close()
    }

    @Test
    fun usesFallbackWhenDisabledForTheItem() {
        val source = newSource(enabled = { false })
        source.open(spec())
        assertArrayEquals(data, source.readFully())
        source.close()
        // One plain request, no Range header.
        assertEquals(1, requestCount.get())
        assertEquals(null, server.takeRequest().getHeader("Range"))
    }

    @Test
    fun retriesAFailedChunk() {
        failuresLeft[2_500L] = AtomicInteger(2)
        val source = newSource(attempts = 3)
        source.open(spec())
        assertArrayEquals(data, source.readFully())
        source.close()
    }

    @Test
    fun propagatesAnErrorOnceRetriesAreExhausted() {
        failuresLeft[2_500L] = AtomicInteger(100)
        val source = newSource(attempts = 2)
        source.open(spec())
        try {
            source.readFully()
            fail("expected an IOException")
        } catch (expected: IOException) {
            // HttpDataSource-style exception surfaced to the loader.
        }
        source.close()
    }

    @Test
    fun keepsConcurrentRequestsAndBufferedChunksBounded() {
        delayMs = { start -> if (start == 0L) 0 else 300 }
        val source = newSource(concurrency = 2)
        source.open(spec())
        Thread.sleep(150)
        // Window is concurrency + slack, but never more than `concurrency` requests at once.
        assertTrue("max concurrent ${maxConcurrent.get()}", maxConcurrent.get() <= 2)
        assertTrue("requests ${requestCount.get()}", requestCount.get() <= 2 + 2)
        assertArrayEquals(data, source.readFully())
        assertTrue("max concurrent ${maxConcurrent.get()}", maxConcurrent.get() <= 2)
        source.close()
    }

    @Test
    fun tenRapidReopenCyclesLeaveNoInFlightCallsAndBoundedWindow() {
        assertEquals(0, awaitNoActiveConnections(2_000).let { ParallelRangeDataSource.activeConnections })
        // Every chunk past the first trickles, so each cycle leaves calls to cancel.
        throttleBytesPerSec = 200
        val source = newSource(concurrency = 3)
        val positions = listOf(0L, 9_000, 2_000, 7_500, 100, 8_800, 4_000, 6_000, 1_500, 9_900)
        for (position in positions) {
            source.open(spec(position = position))
            assertTrue("window ${source.windowSize()}", source.windowSize() <= 3 + 2)
            // Do not wait for data: the next seek arrives straight away.
        }
        source.close()
        awaitNoActiveConnections(3_000)
        assertEquals(0, ParallelRangeDataSource.activeConnections)
        assertEquals(0, source.windowSize())
    }

    @Test
    fun forwardSeekFarPastBufferStartsWithTheSmallInitialChunk() {
        val total = 64L * 1024 * 1024
        val big = MockWebServer()
        val ranges = java.util.Collections.synchronizedList(mutableListOf<String>())
        big.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                val header = request.getHeader("Range")!!
                ranges.add(header)
                val m = Regex("bytes=(\\d+)-(\\d+)").matchEntire(header)!!
                val start = m.groupValues[1].toLong()
                val end = minOf(m.groupValues[2].toLong(), total - 1)
                return MockResponse().setResponseCode(206)
                    .addHeader("Content-Range", "bytes $start-$end/$total")
                    .setBody(Buffer().write(ByteArray((end - start + 1).toInt())))
            }
        }
        big.start()
        try {
            val source = ParallelRangeDataSource(
                client = client,
                fallback = OkHttpDataSource.Factory(client).createDataSource(),
                executor = executor,
                concurrency = 2,
            )
            val position = 40L * 1024 * 1024
            source.open(
                DataSpec.Builder().setUri(Uri.parse(big.url("/m").toString())).setPosition(position).build(),
            )
            source.close()
            val mib = 1024L * 1024
            assertEquals("bytes=$position-${position + mib - 1}", ranges.first())
            assertEquals(ParallelRangeDataSource.DEFAULT_INITIAL_CHUNK_BYTES.toLong(), mib)
        } finally {
            big.shutdown()
        }
    }

    @Test
    fun backwardSeekReopensAtTheEarlierPositionAndReadsCorrectBytes() {
        val source = newSource()
        source.open(spec())
        assertArrayEquals(data, source.readFully())
        source.close()
        rangeHeaders.clear()
        source.open(spec(position = 1_000))
        // The probe is the small first chunk; with the size known, the ramp's chunks may race it.
        assertTrue(rangeHeaders.toString(), "bytes=1000-1499" in rangeHeaders)
        assertTrue(rangeHeaders.toString(), rangeHeaders.none { it.substringAfter("=").substringBefore("-").toLong() < 1_000 })
        assertArrayEquals(data.copyOfRange(1_000, data.size), source.readFully())
        source.close()
    }

    @Test
    fun seekBeyondEndOfFileIsReportedAsPositionOutOfRange() {
        val source = newSource()
        for (position in listOf(data.size.toLong(), data.size + 5_000L)) {
            try {
                source.open(spec(position = position))
                fail("expected position out of range at $position")
            } catch (e: androidx.media3.datasource.DataSourceException) {
                assertEquals(
                    androidx.media3.common.PlaybackException.ERROR_CODE_IO_READ_POSITION_OUT_OF_RANGE,
                    e.reason,
                )
            }
        }
        source.close()
    }

    @Test
    fun closeCancelsThrottledDownloadsWithinBoundedLatency() {
        awaitNoActiveConnections(2_000)
        // 1 KB chunks at 100 B/s would take ~10 s each if not cancelled.
        throttleBytesPerSec = 100
        val source = newSource(concurrency = 3)
        source.open(spec())
        Thread.sleep(200)
        assertTrue("expected downloads in flight", ParallelRangeDataSource.activeConnections > 0)
        val requestsBefore = requestCount.get()
        source.close()
        val latencyMs = awaitNoActiveConnections(3_000)
        assertEquals(0, ParallelRangeDataSource.activeConnections)
        assertTrue("cancellation took ${latencyMs}ms", latencyMs < 1_000)
        // Nothing new is requested after close.
        Thread.sleep(100)
        assertEquals(requestsBefore, requestCount.get())
    }

    private fun streamUri() = spec().uri.toString()

    @Test
    fun aSeekIssuesTheWholeOpeningBurstTogetherOnceTheSizeIsKnown() {
        val source = newSource(concurrency = 3)
        source.open(spec())
        source.close()
        assertEquals(data.size.toLong(), stats.contentLength(streamUri()))

        // 500 + 1000 + 1000 bytes = 3 chunks = concurrency. Every request takes
        // 400 ms: serial probe-then-ramp needs ~800 ms, the combined burst ~400 ms.
        delayMs = { 400L }
        val started = System.nanoTime()
        assertEquals(2_500L, source.open(spec(position = 2_000, length = 2_500)))
        assertArrayEquals(data.copyOfRange(2_000, 4_500), source.readFully())
        val elapsedMs = (System.nanoTime() - started) / 1_000_000
        assertTrue("seek burst took ${elapsedMs}ms", elapsedMs < 650)
        source.close()
    }

    @Test
    fun aStaleCachedSizeIsCorrectedFromTheProbeResponse() {
        for (stale in listOf(20_000L, 5_000L)) {
            stats.recordContentLength(streamUri(), stale)
            val source = newSource(concurrency = 3)
            assertEquals((data.size - 2_000).toLong(), source.open(spec(position = 2_000)))
            assertArrayEquals(data.copyOfRange(2_000, data.size), source.readFully())
            source.close()
            assertEquals(data.size.toLong(), stats.contentLength(streamUri()))
        }
    }

    @Test
    fun countsEveryReceivedByteAndReportsThemToTheTransferListener() {
        val source = newSource(concurrency = 3)
        var reported = 0L
        source.addTransferListener(object : androidx.media3.datasource.TransferListener {
            override fun onTransferInitializing(s: DataSource, d: DataSpec, isNetwork: Boolean) = Unit
            override fun onTransferStart(s: DataSource, d: DataSpec, isNetwork: Boolean) = Unit
            override fun onBytesTransferred(s: DataSource, d: DataSpec, isNetwork: Boolean, bytesTransferred: Int) {
                reported += bytesTransferred
            }

            override fun onTransferEnd(s: DataSource, d: DataSpec, isNetwork: Boolean) = Unit
        })
        source.open(spec())
        assertArrayEquals(data, source.readFully())
        source.close()
        assertEquals(data.size.toLong(), stats.totalBytes())
        assertEquals(data.size.toLong(), reported)
    }

    @Test
    fun aggregateThroughputReflectsAllConnectionsNotOne() {
        // ~8 kB/s per connection (64 kbps); three run at once, so the aggregate must beat one.
        throttleBytesPerSec = 8_000
        val source = newSource(concurrency = 3)
        source.open(spec())
        source.readFully()
        source.close()
        val bps = stats.throughputBps()
        assertTrue("aggregate ${bps}bps should exceed 1.5x one 64 kbps connection", bps > 96_000)
    }
}
