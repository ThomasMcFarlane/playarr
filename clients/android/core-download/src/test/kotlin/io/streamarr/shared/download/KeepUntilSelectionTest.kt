package io.streamarr.shared.download

import io.streamarr.shared.download.db.DownloadMetadataEntity
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class KeepUntilSelectionTest {

    @Test
    fun `forever persists without an expiry`() {
        assertNull(KeepUntilSelection.Forever.persistedDownloadPolicy().epochMillis)
    }

    @Test
    fun `a specific date persists its own epoch millis`() {
        assertEquals(50_000L, KeepUntilSelection.SpecificDate(50_000L).persistedDownloadPolicy().epochMillis)
    }

    @Test
    fun `after watched policy stays unresolved until a watched timestamp exists`() {
        val policy = KeepUntilSelection.AfterWatched(2, KeepUntilUnit.Weeks).persistedDownloadPolicy()
        assertNull(policy.epochMillis)
        assertEquals(2, policy.amount)
        assertEquals("weeks", policy.unit)

        val unresolved = metadata(
            keepUntilAmount = policy.amount,
            keepUntilUnit = policy.unit,
            watchedAtEpochMillis = null,
        )
        assertEquals(KeepUntilSelection.AfterWatched(2, KeepUntilUnit.Weeks), unresolved.keepUntilSelection())
        assertNull(unresolved.downloadExpiryEpochMillis())

        val watched = unresolved.copy(watchedAtEpochMillis = 1_000L)
        assertEquals(1_000L + 14L * 24L * 60L * 60L * 1000L, watched.downloadExpiryEpochMillis())
    }

    @Test
    fun `very large after watched policies saturate instead of wrapping into the past`() {
        val watched = metadata(
            keepUntilAmount = Int.MAX_VALUE,
            keepUntilUnit = "weeks",
            watchedAtEpochMillis = Long.MAX_VALUE - 100L,
        )

        assertEquals(Long.MAX_VALUE, watched.downloadExpiryEpochMillis())
    }

    private fun metadata(
        keepUntilAmount: Int?,
        keepUntilUnit: String?,
        watchedAtEpochMillis: Long?,
    ) = DownloadMetadataEntity(
        mediaFileId = "media",
        workId = "work",
        title = "Title",
        workTitle = "Title",
        posterUrl = null,
        kind = "movie",
        qualityId = "original",
        ticketId = null,
        serverUrl = "https://playarr.example",
        keepUntilEpochMillis = null,
        keepUntilAmount = keepUntilAmount,
        keepUntilUnit = keepUntilUnit,
        watchedAtEpochMillis = watchedAtEpochMillis,
        addedAtEpochMillis = 0,
    )
}
