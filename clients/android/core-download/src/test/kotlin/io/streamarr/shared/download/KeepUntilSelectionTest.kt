package io.streamarr.shared.download

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class KeepUntilSelectionTest {

    @Test
    fun `forever resolves to null`() {
        assertNull(KeepUntilSelection.Forever.resolveEpochMillis(nowEpochMillis = 1_000L))
    }

    @Test
    fun `a specific date resolves to its own epoch millis, ignoring now`() {
        assertEquals(50_000L, KeepUntilSelection.SpecificDate(50_000L).resolveEpochMillis(nowEpochMillis = 1_000L))
    }

    @Test
    fun `days after watched adds whole days to now`() {
        val now = 0L
        val oneDayMillis = 24L * 60L * 60L * 1000L
        assertEquals(
            3 * oneDayMillis,
            KeepUntilSelection.AfterWatched(3, KeepUntilUnit.Days).resolveEpochMillis(now),
        )
    }

    @Test
    fun `weeks after watched are converted to days first`() {
        val now = 0L
        val oneDayMillis = 24L * 60L * 60L * 1000L
        assertEquals(
            14 * oneDayMillis,
            KeepUntilSelection.AfterWatched(2, KeepUntilUnit.Weeks).resolveEpochMillis(now),
        )
    }
}
