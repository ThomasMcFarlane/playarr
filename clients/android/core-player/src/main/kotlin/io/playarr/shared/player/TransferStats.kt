package io.playarr.shared.player

/**
 * Aggregate download statistics for [ParallelRangeDataSource], shared with the
 * load control and the telemetry logger. Clock-injected and thread-safe.
 *
 * Throughput: `DefaultBandwidthMeter` assumes one sequential transfer and is
 * fed bytes as the reader consumes them, so with several parallel chunks and a
 * reader throttled by a full buffer it reports the playback rate (~5 Mbps in
 * the field) rather than what the link can deliver (~160 Mbps). This class
 * instead counts bytes as they arrive on every connection and divides by the
 * wall time during which at least one chunk body was being read. Idle time
 * (buffer full, nothing in flight) is excluded, so the estimate keeps the last
 * observed link rate while the reader is throttled. Samples cover at least
 * [SAMPLE_MS] of active time and are smoothed with a 1/2 EWMA.
 *
 * Content length: the total size learned from `Content-Range`, keyed by
 * request URI, so a bitrate can be derived for containers (MKV) whose tracks
 * declare none, and so a seek can issue its parallel chunks before the probe
 * response has confirmed the size.
 */
class TransferStats(private val clock: () -> Long = { System.nanoTime() / 1_000_000L }) {
    private val lock = Any()
    private var active = 0
    private var lastMs = clock()
    private var accBytes = 0L
    private var accMs = 0L
    private var ewmaBps = 0L
    private var totalBytes = 0L
    private val lengths = object : LinkedHashMap<String, Long>(8, 0.75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, Long>?) = size > MAX_URIS
    }
    private var currentUri: String? = null
    private var currentDurationMs = -1L

    fun onChunkStarted() = synchronized(lock) {
        advance()
        active++
    }

    fun onChunkEnded() = synchronized(lock) {
        advance()
        sampleIfDue()
        if (active > 0) active--
    }

    fun onBytes(count: Int) = synchronized(lock) {
        advance()
        totalBytes += count
        if (active > 0) accBytes += count
        sampleIfDue()
    }

    /** Bytes received over every connection since creation (including abandoned chunks). */
    fun totalBytes(): Long = synchronized(lock) { totalBytes }

    /** Aggregate download rate in bits per second, or 0 before any measurement. */
    fun throughputBps(): Long = synchronized(lock) {
        advance()
        sampleIfDue()
        when {
            ewmaBps > 0 -> ewmaBps
            accMs >= MIN_PARTIAL_MS -> accBytes * 8_000L / accMs
            else -> 0L
        }
    }

    fun recordContentLength(uri: String, totalBytes: Long) = synchronized(lock) {
        if (totalBytes > 0) lengths[uri] = totalBytes
    }

    fun contentLength(uri: String): Long? = synchronized(lock) { lengths[uri] }

    /** Identifies the item being played so its length and duration can be paired. */
    fun setCurrentStream(uri: String?, durationMs: Long) = synchronized(lock) {
        currentUri = uri
        currentDurationMs = durationMs
    }

    /**
     * Average bitrate = content length * 8 / duration for the current stream,
     * or 0 when either is unknown. Includes container overhead and every
     * track, which is what the pipe has to carry.
     */
    fun derivedBitrateBps(): Long = synchronized(lock) {
        val length = currentUri?.let { lengths[it] } ?: return 0L
        if (length <= 0 || currentDurationMs <= 0) return 0L
        length * 8_000L / currentDurationMs
    }

    private fun advance() {
        val now = clock()
        if (active > 0) accMs += (now - lastMs).coerceAtLeast(0L)
        lastMs = now
    }

    private fun sampleIfDue() {
        if (accMs < SAMPLE_MS) return
        val rate = accBytes * 8_000L / accMs
        ewmaBps = if (ewmaBps == 0L) rate else (ewmaBps + rate) / 2
        accBytes = 0
        accMs = 0
    }

    companion object {
        const val SAMPLE_MS = 400L
        private const val MIN_PARTIAL_MS = 100L
        private const val MAX_URIS = 8

        /** Process-wide instance used by the player and its data sources. */
        val shared = TransferStats()
    }
}
