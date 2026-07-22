package io.streamarr.mobile.update

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Test

class AppUpdateEffectTest {

    @Test
    fun `missing Play update service is a no-op`() = runBlocking {
        assertNull(bestEffortUpdateCheck { throw IllegalStateException("Play service unavailable") })
        assertFalse(bestEffortUpdateStart { throw IllegalStateException("Play service unavailable") })
    }

    @Test
    fun `update check preserves coroutine cancellation`() {
        assertThrows(CancellationException::class.java) {
            runBlocking {
                bestEffortUpdateCheck { throw CancellationException("cancelled") }
            }
        }
    }
}
