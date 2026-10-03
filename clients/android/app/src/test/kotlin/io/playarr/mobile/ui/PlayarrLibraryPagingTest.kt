package io.playarr.mobile.ui

import io.playarr.shared.data.model.Availability
import io.playarr.shared.data.model.Work
import io.playarr.shared.data.model.WorkKind
import java.time.Instant
import org.junit.Assert.assertEquals
import org.junit.Assert.assertSame
import org.junit.Test

class PlayarrLibraryPagingTest {
    @Test
    fun `first page is returned unchanged`() {
        val page = listOf(work("a"), work("b"))
        assertSame(page, mergeLibraryPage(emptyList(), page))
    }

    @Test
    fun `later pages are appended without duplicating works`() {
        val merged = mergeLibraryPage(
            loaded = listOf(work("a"), work("b")),
            page = listOf(work("b"), work("c")),
        )
        assertEquals(listOf("a", "b", "c"), merged.map(Work::id))
    }

    @Test
    fun `page size matches the web client`() {
        assertEquals(200L, LIBRARY_PAGE_SIZE)
    }

    private fun work(id: String) = Work(
        id = id,
        kind = WorkKind.Movie,
        title = id,
        sortTitle = id,
        addedAt = Instant.EPOCH,
        monitored = true,
        availability = Availability.Available,
    )
}
