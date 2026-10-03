package io.playarr.shared.domain.model

import java.io.IOException
import java.net.SocketTimeoutException
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class PlayarrResultRetryTest {
    @Test
    fun retriesNetworkFailuresUntilSuccess() = runBlocking {
        var calls = 0
        val result = runCatchingPlayarrRetrying(attempts = 3, backoffMs = listOf(0L)) {
            calls++
            if (calls < 3) throw SocketTimeoutException("connect timed out")
            "ok"
        }
        assertEquals(PlayarrResult.Success("ok"), result)
        assertEquals(3, calls)
    }

    @Test
    fun givesUpAfterTheConfiguredAttemptsAndReportsTheNetworkError() = runBlocking {
        var calls = 0
        val result = runCatchingPlayarrRetrying<String>(attempts = 3, backoffMs = listOf(0L)) {
            calls++
            throw IOException("unreachable")
        }
        assertEquals(3, calls)
        assertTrue((result as PlayarrResult.Failure).error is PlayarrError.Network)
    }

    @Test
    fun doesNotRetryNonNetworkFailures() = runBlocking {
        var calls = 0
        val result = runCatchingPlayarrRetrying<String>(attempts = 3, backoffMs = listOf(0L)) {
            calls++
            throw IllegalStateException("decode")
        }
        assertEquals(1, calls)
        assertTrue((result as PlayarrResult.Failure).error is PlayarrError.Unknown)
    }
}
