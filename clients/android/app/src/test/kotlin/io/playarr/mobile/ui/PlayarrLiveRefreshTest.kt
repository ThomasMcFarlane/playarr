package io.playarr.mobile.ui

import io.playarr.mobile.liveEventsSessionKey
import io.playarr.shared.data.model.CalendarEntry
import io.playarr.shared.data.model.CalendarFeedCreated
import io.playarr.shared.data.model.CalendarFeedStatus
import io.playarr.shared.data.model.CalendarResponse
import io.playarr.shared.domain.repository.CalendarRepository
import java.time.DayOfWeek
import java.time.LocalDate
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class PlayarrLiveRefreshTest {
    private class Repo : CalendarRepository {
        var gate: CompletableDeferred<Unit>? = null
        var failing = false
        var titles = listOf("old")
        override suspend fun calendar(start: LocalDate, end: LocalDate): CalendarResponse {
            gate?.await()
            if (failing) throw java.io.IOException("down")
            return CalendarResponse(
                start,
                end,
                titles.map { CalendarEntry(id = it, mediaKind = "episode", releaseType = "air", title = it, date = start) },
            )
        }
        override suspend fun feedStatus() = CalendarFeedStatus(active = false)
        override suspend fun createFeed(): CalendarFeedCreated = error("unused")
        override suspend fun revokeFeed() = Unit
        override suspend fun availabilityLag(workId: String) = io.playarr.shared.data.model.AvailabilityLag()
    }

    private fun holder(repo: Repo) = CalendarStateHolder(
        CoroutineScope(SupervisorJob() + Dispatchers.Unconfined),
        repo,
        { LocalDate.parse("2026-10-04") },
        DayOfWeek.MONDAY,
    )

    private fun CalendarStateHolder.titles() =
        ((state.value.load as CalendarLoad.Ready).response.entries).map { it.title }

    @Test
    fun `calendar refresh swaps data in place without ever showing loading`() {
        val repo = Repo()
        val holder = holder(repo)
        holder.load()
        assertEquals(listOf("old"), holder.titles())
        val first = holder.fetchStartedMs
        assertTrue(first > 0)
        repo.titles = listOf("new")
        repo.gate = CompletableDeferred()
        holder.refresh()
        // While the refetch is in flight the stale entries stay on screen.
        assertEquals(listOf("old"), holder.titles())
        repo.gate!!.complete(Unit)
        assertEquals(listOf("new"), holder.titles())
    }

    @Test
    fun `calendar refresh failure keeps the shown entries`() {
        val repo = Repo()
        val holder = holder(repo)
        holder.load()
        repo.failing = true
        holder.refresh()
        assertEquals(listOf("old"), holder.titles())
    }

    @Test
    fun `session key is null when signed out and changes with server or account`() {
        assertNull(liveEventsSessionKey(null, "https://a", "u1"))
        assertNull(liveEventsSessionKey("  ", "https://a", "u1"))
        val a = liveEventsSessionKey("t1", "https://a", "u1")
        assertEquals(a, liveEventsSessionKey("t2-rotated", "https://a", "u1"))
        assertTrue(a != liveEventsSessionKey("t1", "https://b", "u1"))
        assertTrue(a != liveEventsSessionKey("t1", "https://a", "u2"))
    }
}
