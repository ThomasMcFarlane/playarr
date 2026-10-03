package io.playarr.mobile.ui

import java.util.concurrent.atomic.AtomicInteger
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PlayarrImageLoadingTest {
    @Test
    fun recognisesOnlyFrameThumbnailUrls() {
        assertTrue(isPlayarrFrameThumbnailUrl("https://s.example:8484/api/v1/media/abc-123/thumbnail"))
        assertTrue(isPlayarrFrameThumbnailUrl("https://s.example/api/v1/media/abc/thumbnail?position_ms=273315"))
        assertFalse(isPlayarrFrameThumbnailUrl("https://s.example/api/v1/artwork/work/abc/poster"))
        assertFalse(isPlayarrFrameThumbnailUrl("https://image.tmdb.org/t/p/original/x.jpg"))
        assertFalse(isPlayarrFrameThumbnailUrl(null))
        assertFalse(isPlayarrFrameThumbnailUrl(42))
    }

    @Test
    fun neverRunsMoreThanTheLimitConcurrently() = runBlocking {
        val gate = PlayarrFrameThumbnailGate(limit = 2, retryDelayMs = 0)
        val active = AtomicInteger()
        val peak = AtomicInteger()
        List(10) {
            async(kotlinx.coroutines.Dispatchers.Default) {
                gate.run<Boolean>(failed = { false }) {
                    peak.accumulateAndGet(active.incrementAndGet(), ::maxOf)
                    delay(20)
                    active.decrementAndGet()
                    true
                }
            }
        }.awaitAll()
        assertTrue(peak.get() in 1..2)
    }

    @Test
    fun retriesAFailedLoadOnceThenGivesUp() = runBlocking {
        val gate = PlayarrFrameThumbnailGate(limit = 2, retryDelayMs = 0)
        val calls = AtomicInteger()
        val result = gate.run<String>(failed = { it == "error" }) {
            calls.incrementAndGet()
            "error"
        }
        assertEquals("error", result)
        assertEquals(2, calls.get())
        val recovered = AtomicInteger()
        val ok = gate.run<String>(failed = { it == "error" }) {
            if (recovered.incrementAndGet() == 1) "error" else "image"
        }
        assertEquals("image", ok)
    }
}
