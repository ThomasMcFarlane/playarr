package io.playarr.shared.player

import android.net.Uri
import androidx.media3.common.C
import androidx.media3.common.PlaybackException
import androidx.media3.datasource.BaseDataSource
import androidx.media3.datasource.DataSource
import androidx.media3.datasource.DataSourceException
import androidx.media3.datasource.DataSpec
import androidx.media3.datasource.HttpDataSource
import java.io.IOException
import java.io.InterruptedIOException
import java.util.ArrayDeque
import java.util.concurrent.CancellationException
import java.util.concurrent.CompletableFuture
import java.util.concurrent.ExecutionException
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicLong
import okhttp3.Call
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response

/**
 * Progressive HTTP [DataSource] that hides high round-trip latency by keeping
 * several `Range` requests in flight ahead of the read position.
 *
 * A single TCP flow over a ~200 ms path tops out near the average bitrate of
 * a 4K remux, so direct play would rebuffer on every peak. Here the
 * requested span is cut into fixed [chunkBytes] pieces (the first one
 * smaller so a start or seek is quick), up to [concurrency] pieces download
 * at once on separate connections, and bytes are handed to ExoPlayer strictly
 * in order whatever order the pieces finish in.
 *
 * Memory is bounded by [concurrency] + [READ_AHEAD_SLACK] chunks: a new chunk
 * is only scheduled when the head chunk has been fully consumed and dropped.
 *
 * Anything the scheme cannot handle (non-GET, non-HTTP, no 206 / numeric
 * `Content-Range` total, or the data source being disabled for this item)
 * is delegated unchanged to [fallback], i.e. the plain single-connection
 * behaviour. `close()` cancels every outstanding chunk, which is what a
 * Media3 seek (close + reopen) relies on.
 *
 * Seek behaviour (verified by `ParallelRangeDataSourceTest`): a Media3 seek is
 * `close()` then `open(newPosition)`. `close()` cancels every outstanding call
 * synchronously (`Call.cancel` aborts blocked body reads), so no bytes for the
 * abandoned range keep downloading, and the window is cleared. `open` starts
 * with a [initialChunkBytes] (1 MiB) probe at the new position for a fast
 * first frame, then ramps to [chunkBytes] pieces. When the size is already
 * known from an earlier open of the same URI, the ramp's chunks are requested
 * together with the probe rather than after its response (see `open`). This class keeps no cache:
 * a backward seek into data ExoPlayer still holds is served from ExoPlayer's
 * own buffer and never reaches here; Media3 only keeps played data if a back
 * buffer is configured (see `ExoPlayerPlayarrPlayer.buildLoadControl`).
 * Anything outside that buffer is a fresh ranged fetch.
 *
 * Give this a client restricted to HTTP/1.1: over HTTP/2 OkHttp would
 * multiplex every chunk on one TCP connection and defeat the purpose.
 */
class ParallelRangeDataSource(
    private val client: OkHttpClient,
    private val fallback: DataSource,
    private val executor: ExecutorService,
    private val concurrency: Int = DEFAULT_CONCURRENCY,
    private val chunkBytes: Int = DEFAULT_CHUNK_BYTES,
    private val initialChunkBytes: Int = DEFAULT_INITIAL_CHUNK_BYTES,
    private val maxChunkAttempts: Int = DEFAULT_CHUNK_ATTEMPTS,
    private val retryDelayMs: Long = DEFAULT_RETRY_DELAY_MS,
    private val isEnabled: () -> Boolean = { true },
    private val stats: TransferStats = TransferStats.shared,
) : BaseDataSource(/* isNetwork = */ true), HttpDataSource {

    private class Chunk(val start: Long, val endExclusive: Long, val received: AtomicLong) {
        val result = CompletableFuture<ByteArray>()

        @Volatile var call: Call? = null

        @Volatile var cancelled = false
        val size: Int get() = (endExclusive - start).toInt()

        fun cancel() {
            cancelled = true
            call?.cancel()
            result.cancel(false)
        }
    }

    private var dataSpec: DataSpec? = null
    private var uri: Uri? = null
    private var responseHeaders: Map<String, List<String>> = emptyMap()
    private var delegating = false
    private var opened = false
    private var requestHeaders = HashMap<String, String>()

    private val window = ArrayDeque<Chunk>()
    private var nextChunkStart = 0L
    private var endPosition = 0L
    private var readPosition = 0L
    private var headData: ByteArray? = null
    private var headOffset = 0
    private var finished = false

    /** Bytes received for the current open; chunks of an abandoned open keep their own. */
    private var openReceived = AtomicLong()
    private var reportedBytes = 0L

    init {
        require(concurrency >= 1 && chunkBytes > 0 && initialChunkBytes > 0)
    }

    override fun open(dataSpec: DataSpec): Long {
        close()
        this.dataSpec = dataSpec
        val scheme = dataSpec.uri.scheme
        val eligible = isEnabled() &&
            (scheme == "http" || scheme == "https") &&
            dataSpec.httpMethod == DataSpec.HTTP_METHOD_GET &&
            dataSpec.httpBody == null
        if (!eligible) return openFallback(dataSpec)

        transferInitializing(dataSpec)
        val position = dataSpec.position
        val firstEnd = boundedEnd(position, dataSpec.length, initialChunkBytes.toLong())
        val probeCall = client.newCall(buildRequest(dataSpec, position, firstEnd - 1))
        openReceived = AtomicLong()
        reportedBytes = 0L

        // Fast seek start. Once the size is known from an earlier open of this
        // URI, the probe and the next `concurrency - 1` chunks are requested at
        // the same moment instead of the ramp waiting for the probe's response
        // (one full RTT plus connection setup). Expected latency for the 62 Mbps
        // remux over 200 ms RTT at ~20 MB/s (160 Mbps): the post-seek start
        // threshold is 3 s of media = 3 s * 7.75 MB/s ~ 23 MB, and the opening
        // burst (1 MiB + 7 * 4 MiB ~ 29 MiB) already covers it. Time to ready
        // ~ 3 RTT for connect + request (~0.6 s) + 23 MB / 20 MB/s (~1.2 s) +
        // decoder/keyframe slack (~0.5 s) ~ 2.3 s, versus the old probe, wait,
        // then ramp sequence that cost an extra 1-2 RTT and idle connections.
        val knownTotal = stats.contentLength(dataSpec.uri.toString())
        var speculative: Chunk? = null
        if (knownTotal != null && knownTotal > position) {
            speculative = startWindow(position, bounded(position, knownTotal, dataSpec.length), firstEnd, probeCall)
        }
        val response = try {
            probeCall.execute()
        } catch (e: IOException) {
            discardWindow()
            throw HttpDataSource.HttpDataSourceException.createForIOException(
                e,
                dataSpec,
                HttpDataSource.HttpDataSourceException.TYPE_OPEN,
            )
        }

        val range = if (response.code == 206) parseContentRange(response.header("Content-Range")) else null
        if (response.code == 416) {
            response.close()
            discardWindow()
            throw DataSourceException(PlaybackException.ERROR_CODE_IO_READ_POSITION_OUT_OF_RANGE)
        }
        if (range == null || range.start != position || range.total <= 0) {
            // 200 / no Content-Range / unknown total: not worth parallelising.
            val code = response.code
            val headers = response.headers.toMultimap()
            response.close()
            discardWindow()
            if (code !in 200..299) {
                throw HttpDataSource.InvalidResponseCodeException(
                    code,
                    response.message,
                    null,
                    headers,
                    dataSpec,
                    ByteArray(0),
                )
            }
            return openFallback(dataSpec, announce = false)
        }
        stats.recordContentLength(dataSpec.uri.toString(), range.total)

        val actualEnd = bounded(position, range.total, dataSpec.length)
        if (position >= actualEnd) {
            response.close()
            discardWindow()
            throw DataSourceException(PlaybackException.ERROR_CODE_IO_READ_POSITION_OUT_OF_RANGE)
        }
        val first: Chunk
        if (speculative != null && endPosition == actualEnd && speculative.endExclusive == range.endInclusive + 1) {
            first = speculative
        } else {
            // The cached size was stale (or the server capped the range): start again from the truth.
            // The probe call stays alive: it carries the response being reused.
            speculative?.call = null
            discardWindow()
            first = startWindow(position, actualEnd, minOf(range.endInclusive + 1, actualEnd), probeCall)
        }
        uri = Uri.parse(response.request.url.toString())
        val span = endPosition - position
        responseHeaders = response.headers.toMultimap().toMutableMap().apply {
            put("Content-Length", listOf(span.toString()))
        }
        readPosition = position
        finished = false
        opened = true

        // Chunk 0 reuses the probe response so opening costs a single round trip.
        executor.execute { downloadFirst(first, response) }

        transferStarted(dataSpec)
        return span
    }

    private fun bounded(position: Long, total: Long, length: Long): Long =
        if (length != C.LENGTH_UNSET.toLong()) minOf(total, position + length) else total

    /**
     * Sets up the window for `[position, end)` with chunk 0 ending at [firstEnd]
     * (its request is [probeCall], executed by the caller) and starts the
     * following chunks right away. Returns chunk 0.
     */
    private fun startWindow(position: Long, end: Long, firstEnd: Long, probeCall: Call): Chunk {
        endPosition = end
        val first = Chunk(position, minOf(firstEnd, end), openReceived)
        first.call = probeCall
        nextChunkStart = first.endExclusive
        window.addLast(first)
        fillWindow()
        return first
    }

    private fun discardWindow() {
        for (chunk in window) chunk.cancel()
        window.clear()
        headData = null
        headOffset = 0
    }

    override fun read(buffer: ByteArray, offset: Int, length: Int): Int {
        if (delegating) {
            val n = fallback.read(buffer, offset, length)
            if (n > 0) {
                stats.onBytes(n)
                bytesTransferred(n)
            }
            return n
        }
        if (length == 0) return 0
        if (!opened || finished) return C.RESULT_END_OF_INPUT
        scheduleWaiting()
        var data = headData
        if (data == null || headOffset >= data.size) {
            retireHead()
            if (readPosition >= endPosition) {
                finished = true
                return C.RESULT_END_OF_INPUT
            }
            val head = window.peekFirst() ?: return C.RESULT_END_OF_INPUT
            data = await(head)
            headData = data
            headOffset = 0
        }
        val count = minOf(length, data.size - headOffset)
        System.arraycopy(data, headOffset, buffer, offset, count)
        headOffset += count
        readPosition += count
        // Report what the connections downloaded since the last read, not just
        // what this read consumed: with a throttled reader, consumed bytes
        // would make the bandwidth meter see the playback rate instead of the
        // link rate. (The policy prefers TransferStats; this keeps the meter
        // closer to the truth for anything else that reads it.)
        val received = openReceived.get()
        val delta = (received - reportedBytes).coerceIn(0L, Int.MAX_VALUE.toLong()).toInt()
        if (delta > 0) {
            reportedBytes += delta
            bytesTransferred(delta)
        }
        return count
    }

    override fun getUri(): Uri? = if (delegating) fallback.uri else uri

    override fun getResponseHeaders(): Map<String, List<String>> =
        if (delegating) fallback.responseHeaders else responseHeaders

    override fun getResponseCode(): Int = if (delegating) -1 else if (opened) 206 else -1

    override fun setRequestProperty(name: String, value: String) {
        requestHeaders[name] = value
        (fallback as? HttpDataSource)?.setRequestProperty(name, value)
    }

    override fun clearRequestProperty(name: String) {
        requestHeaders.remove(name)
        (fallback as? HttpDataSource)?.clearRequestProperty(name)
    }

    override fun clearAllRequestProperties() {
        requestHeaders.clear()
        (fallback as? HttpDataSource)?.clearAllRequestProperties()
    }

    override fun close() {
        if (delegating) {
            delegating = false
            fallback.close()
            transferEnded()
        }
        val wasOpened = opened
        opened = false
        discardWindow()
        uri = null
        responseHeaders = emptyMap()
        if (wasOpened) transferEnded()
    }

    private fun openFallback(dataSpec: DataSpec, announce: Boolean = true): Long {
        // Transfer events are reported here, not by the fallback (it has no
        // listeners of its own), so the bandwidth meter sees one transfer per open.
        if (announce) transferInitializing(dataSpec)
        val length = fallback.open(dataSpec)
        delegating = true
        uri = null
        transferStarted(dataSpec)
        return length
    }

    /** Drops the fully consumed head chunk and tops the window back up. */
    private fun retireHead() {
        val data = headData ?: return
        if (headOffset >= data.size) {
            window.pollFirst()
            headData = null
            headOffset = 0
            fillWindow()
        }
    }

    private fun fillWindow() {
        while (window.size < concurrency + READ_AHEAD_SLACK && nextChunkStart < endPosition) {
            val end = boundedEnd(nextChunkStart, endPosition - nextChunkStart, chunkBytes.toLong())
            val chunk = Chunk(nextChunkStart, end, openReceived)
            nextChunkStart = end
            window.addLast(chunk)
            // Only `concurrency` chunks download at once; slack chunks wait their turn.
            scheduleIfCapacity(chunk)
        }
        scheduleWaiting()
    }

    private fun inFlight(): Int = window.count { it.call != null && !it.result.isDone }

    private fun scheduleIfCapacity(chunk: Chunk) {
        if (inFlight() < concurrency && chunk.call == null) startChunk(chunk)
    }

    private fun scheduleWaiting() {
        for (chunk in window) {
            if (inFlight() >= concurrency) return
            if (chunk.call == null && !chunk.result.isDone) startChunk(chunk)
        }
    }

    private fun startChunk(chunk: Chunk) {
        val call = client.newCall(buildRequest(checkNotNull(dataSpec), chunk.start, chunk.endExclusive - 1))
        chunk.call = call
        executor.execute { downloadChunk(chunk, call) }
    }

    private fun downloadFirst(chunk: Chunk, response: Response) {
        ACTIVE_CONNECTIONS.incrementAndGet()
        try {
            chunk.result.complete(readBody(chunk, response))
        } catch (e: Throwable) {
            retryOrFail(chunk, e, attempt = 1)
        } finally {
            ACTIVE_CONNECTIONS.decrementAndGet()
        }
    }

    private fun downloadChunk(chunk: Chunk, firstCall: Call) {
        ACTIVE_CONNECTIONS.incrementAndGet()
        try {
            var call = firstCall
            var attempt = 1
            while (true) {
                try {
                    val response = call.execute()
                    chunk.result.complete(readBody(chunk, response))
                    return
                } catch (e: Throwable) {
                    if (!retryDelayAndCheck(chunk, e, attempt)) return
                    attempt++
                    call = client.newCall(buildRequest(checkNotNull(dataSpec), chunk.start, chunk.endExclusive - 1))
                    chunk.call = call
                }
            }
        } finally {
            ACTIVE_CONNECTIONS.decrementAndGet()
        }
    }

    /** First-chunk failure: retry as an ordinary chunk request. */
    private fun retryOrFail(chunk: Chunk, error: Throwable, attempt: Int) {
        var attempts = attempt
        var failure = error
        while (retryDelayAndCheck(chunk, failure, attempts)) {
            attempts++
            val call = client.newCall(buildRequest(checkNotNull(dataSpec), chunk.start, chunk.endExclusive - 1))
            chunk.call = call
            try {
                chunk.result.complete(readBody(chunk, call.execute()))
                return
            } catch (e: Throwable) {
                failure = e
            }
        }
    }

    /**
     * Returns true when another attempt should be made. Completes the chunk
     * exceptionally (and returns false) when retries are exhausted, the error
     * is permanent, or the chunk was cancelled by a seek/close.
     */
    private fun retryDelayAndCheck(chunk: Chunk, error: Throwable, attempt: Int): Boolean {
        if (chunk.cancelled || chunk.result.isDone) return false
        val permanent = error is HttpDataSource.InvalidResponseCodeException &&
            error.responseCode in 400..499 && error.responseCode != 408 && error.responseCode != 429
        if (permanent || attempt >= maxChunkAttempts) {
            chunk.result.completeExceptionally(error)
            return false
        }
        try {
            Thread.sleep(retryDelayMs * attempt)
        } catch (_: InterruptedException) {
            Thread.currentThread().interrupt()
            chunk.result.completeExceptionally(error)
            return false
        }
        return !chunk.cancelled
    }

    private fun readBody(chunk: Chunk, response: Response): ByteArray = response.use {
        val spec = checkNotNull(dataSpec)
        val headers = response.headers.toMultimap()
        if (response.code != 206) {
            throw HttpDataSource.InvalidResponseCodeException(
                response.code,
                response.message,
                null,
                headers,
                spec,
                ByteArray(0),
            )
        }
        val range = parseContentRange(response.header("Content-Range"))
        if (range == null || range.start != chunk.start) {
            throw HttpDataSource.HttpDataSourceException(
                "Unexpected Content-Range ${response.header("Content-Range")} for chunk starting at ${chunk.start}",
                spec,
                PlaybackException.ERROR_CODE_IO_UNSPECIFIED,
                HttpDataSource.HttpDataSourceException.TYPE_READ,
            )
        }
        val body = response.body
        val data = ByteArray(chunk.size)
        val stream = body.byteStream()
        var filled = 0
        stats.onChunkStarted()
        try {
            while (filled < data.size) {
                if (chunk.cancelled) throw CancellationException()
                val n = stream.read(data, filled, data.size - filled)
                if (n < 0) break
                filled += n
                chunk.received.addAndGet(n.toLong())
                stats.onBytes(n)
            }
        } finally {
            stats.onChunkEnded()
        }
        if (filled < data.size) throw IOException("Chunk truncated: $filled of ${data.size} bytes")
        data
    }

    private fun await(chunk: Chunk): ByteArray {
        val spec = checkNotNull(dataSpec)
        try {
            return chunk.result.get()
        } catch (e: InterruptedException) {
            Thread.currentThread().interrupt()
            throw InterruptedIOException()
        } catch (e: CancellationException) {
            throw IOException("Chunk request cancelled", e)
        } catch (e: ExecutionException) {
            val cause = e.cause ?: e
            if (cause is HttpDataSource.HttpDataSourceException) throw cause
            if (cause is IOException) {
                throw HttpDataSource.HttpDataSourceException.createForIOException(
                    cause,
                    spec,
                    HttpDataSource.HttpDataSourceException.TYPE_READ,
                )
            }
            throw HttpDataSource.HttpDataSourceException(
                IOException(cause),
                spec,
                PlaybackException.ERROR_CODE_IO_UNSPECIFIED,
                HttpDataSource.HttpDataSourceException.TYPE_READ,
            )
        }
    }

    private fun buildRequest(spec: DataSpec, from: Long, toInclusive: Long): Request {
        val builder = Request.Builder().url(spec.uri.toString())
        requestHeaders.forEach { (k, v) -> builder.header(k, v) }
        spec.httpRequestHeaders.forEach { (k, v) -> builder.header(k, v) }
        builder.header("Range", "bytes=$from-$toInclusive")
        // Ranges must address the raw bytes, never a gzip-transcoded body.
        builder.header("Accept-Encoding", "identity")
        return builder.build()
    }

    private fun boundedEnd(start: Long, limit: Long, size: Long): Long {
        val end = start + size
        return if (limit == C.LENGTH_UNSET.toLong() || limit < 0) end else minOf(end, start + limit)
    }

    private class ContentRange(val start: Long, val endInclusive: Long, val total: Long)

    private fun parseContentRange(header: String?): ContentRange? {
        val match = header?.let { CONTENT_RANGE.matchEntire(it.trim()) } ?: return null
        return ContentRange(
            match.groupValues[1].toLong(),
            match.groupValues[2].toLong(),
            match.groupValues[3].toLong(),
        )
    }

    /**
     * Builds [ParallelRangeDataSource]s that share one worker pool.
     * [isEnabled] is read on every `open`, letting the player switch the
     * parallel path off for HLS/transcode items without rebuilding sources.
     */
    class Factory(
        private val client: OkHttpClient,
        private val fallbackFactory: DataSource.Factory,
        private val concurrency: Int = DEFAULT_CONCURRENCY,
        private val chunkBytes: Int = DEFAULT_CHUNK_BYTES,
        private val isEnabled: () -> Boolean = { true },
    ) : DataSource.Factory {
        private val executor: ExecutorService = Executors.newCachedThreadPool { runnable ->
            Thread(runnable, "playarr-range").apply { isDaemon = true }
        }

        override fun createDataSource(): DataSource = ParallelRangeDataSource(
            client = client,
            fallback = fallbackFactory.createDataSource(),
            executor = executor,
            concurrency = concurrency,
            chunkBytes = chunkBytes,
            isEnabled = isEnabled,
        )
    }

    companion object {
        const val DEFAULT_CONCURRENCY = 8
        const val DEFAULT_CHUNK_BYTES = 4 * 1024 * 1024
        const val DEFAULT_INITIAL_CHUNK_BYTES = 1024 * 1024
        const val DEFAULT_CHUNK_ATTEMPTS = 3
        const val DEFAULT_RETRY_DELAY_MS = 200L

        /** Chunks that may sit finished/queued beyond the in-flight ones. */
        private const val READ_AHEAD_SLACK = 2

        private val CONTENT_RANGE = Regex("""bytes (\d+)-(\d+)/(\d+)""")
        private val ACTIVE_CONNECTIONS = AtomicInteger()

        /** Chunk requests currently downloading, for playback telemetry. */
        val activeConnections: Int get() = ACTIVE_CONNECTIONS.get()
    }
}
