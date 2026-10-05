package io.playarr.mobile.ui

import io.playarr.shared.data.model.AvailabilityLag
import io.playarr.shared.data.model.CalendarEntry
import io.playarr.shared.data.model.CalendarFeedCreated
import io.playarr.shared.data.model.CalendarFeedStatus
import io.playarr.shared.data.model.CalendarMediaKind
import io.playarr.shared.data.model.CalendarResponse
import io.playarr.shared.data.model.CalendarSourceStatus
import io.playarr.shared.domain.repository.CalendarRepository
import java.io.IOException
import java.time.DayOfWeek
import java.time.Instant
import java.time.LocalDate
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import org.junit.Assert.assertEquals
import io.playarr.shared.data.model.CalendarAction
import io.playarr.shared.data.model.TitleSnapshot
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

private class FakeCalendarRepository : CalendarRepository {
    val requests = mutableListOf<Pair<LocalDate, LocalDate>>()
    var gate: CompletableDeferred<Unit>? = null
    var failure: Throwable? = null
    var response: (LocalDate, LocalDate) -> CalendarResponse = { start, end -> CalendarResponse(start, end) }
    var feed = CalendarFeedStatus(active = false)
    var createCount = 0
    var revokeCount = 0
    var lastRotate: Boolean? = null
    val requested = mutableListOf<TitleSnapshot>()
    val watchlisted = mutableListOf<Pair<TitleSnapshot, Boolean>>()

    override suspend fun calendar(start: LocalDate, end: LocalDate): CalendarResponse {
        requests += start to end
        gate?.await()
        failure?.let { throw it }
        return response(start, end)
    }

    override suspend fun feedStatus() = feed

    override suspend fun requestTitle(snapshot: TitleSnapshot) {
        failure?.let { throw it }
        requested += snapshot
    }

    override suspend fun setWatchlisted(snapshot: TitleSnapshot, listed: Boolean) {
        failure?.let { throw it }
        watchlisted += snapshot to listed
    }

    override suspend fun createFeed(rotate: Boolean): CalendarFeedCreated {
        failure?.let { throw it }
        lastRotate = rotate
        createCount++
        feed = CalendarFeedStatus(active = true, createdAt = Instant.parse("2026-10-04T08:00:00Z"))
        return CalendarFeedCreated("https://playarr.example/feed/token$createCount.ics", "token$createCount", Instant.parse("2026-10-04T08:00:00Z"))
    }

    override suspend fun revokeFeed() {
        failure?.let { throw it }
        revokeCount++
        feed = CalendarFeedStatus(active = false)
    }

    override suspend fun availabilityLag(workId: String) = AvailabilityLag()
}

class PlayarrCalendarStateTest {
    private val today = LocalDate.parse("2026-10-04")
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Unconfined)
    private val message: (io.playarr.shared.domain.model.PlayarrError) -> PlayarrMessage =
        { PlayarrMessage.Dynamic("failed") }

    private fun holder(repo: CalendarRepository, mode: CalendarViewMode = CalendarViewMode.Agenda) =
        CalendarStateHolder(scope, repo, { today }, DayOfWeek.MONDAY, mode, message)

    private fun entry(id: String, date: String, kind: String = "episode") = CalendarEntry(
        id = id,
        mediaKind = kind,
        releaseType = "air",
        title = id,
        date = LocalDate.parse(date),
    )

    @Test
    fun `initial load requests today plus thirty days and exposes entries and failed sources`() {
        val repo = FakeCalendarRepository().apply {
            response = { start, end ->
                CalendarResponse(
                    start,
                    end,
                    entries = listOf(entry("a", "2026-10-05")),
                    sources = listOf(CalendarSourceStatus("1", "Radarr", "radarr", "unreachable", "timed out", 0)),
                )
            }
        }
        val holder = holder(repo)
        holder.load()

        assertEquals(listOf(today to LocalDate.parse("2026-11-03")), repo.requests)
        val ready = holder.state.value.load as CalendarLoad.Ready
        assertEquals(1, ready.response.entries.size)
        assertEquals(listOf("Radarr"), failedCalendarSources(ready.response.sources).map { it.name })
    }

    @Test
    fun `a failing request surfaces an error and retry recovers`() {
        val repo = FakeCalendarRepository().apply { failure = IOException("offline") }
        val holder = holder(repo)
        holder.load()
        assertTrue(holder.state.value.load is CalendarLoad.Failed)

        repo.failure = null
        holder.load()
        assertTrue(holder.state.value.load is CalendarLoad.Ready)
    }

    @Test
    fun `next previous and today move the window and refetch`() {
        val repo = FakeCalendarRepository()
        val holder = holder(repo)
        holder.load()
        holder.next()
        assertEquals(LocalDate.parse("2026-11-04"), holder.state.value.window.start)
        holder.previous()
        holder.previous()
        assertEquals(LocalDate.parse("2026-09-03"), holder.state.value.window.start)
        holder.goToToday()
        assertEquals(today, holder.state.value.window.start)
        assertEquals(5, repo.requests.size)
    }

    @Test
    fun `switching view keeps the reader's place and fetches the new window`() {
        val repo = FakeCalendarRepository()
        val holder = holder(repo)
        holder.load()
        holder.setMode(CalendarViewMode.Month)
        assertEquals(LocalDate.parse("2026-09-28") to LocalDate.parse("2026-11-01"), repo.requests.last())
        holder.setMode(CalendarViewMode.Week)
        assertEquals(LocalDate.parse("2026-09-28") to LocalDate.parse("2026-10-04"), repo.requests.last())
    }

    @Test
    fun `kind filter is client side and does not refetch`() {
        val repo = FakeCalendarRepository()
        val holder = holder(repo)
        holder.load()
        holder.toggleKind(CalendarMediaKind.Movie)
        assertEquals(setOf(CalendarMediaKind.Movie), holder.state.value.kinds)
        holder.toggleKind(CalendarMediaKind.Movie)
        assertTrue(holder.state.value.kinds.isEmpty())
        holder.toggleKind(CalendarMediaKind.Book)
        holder.clearKinds()
        assertTrue(holder.state.value.kinds.isEmpty())
        assertEquals(1, repo.requests.size)
    }

    @Test
    fun `a slow response for a window that was navigated away from is discarded`() {
        val repo = FakeCalendarRepository().apply { gate = CompletableDeferred() }
        val holder = holder(repo)
        holder.load()
        val first = repo.gate!!
        repo.gate = null
        holder.next()
        assertEquals(LocalDate.parse("2026-11-04"), (holder.state.value.load as CalendarLoad.Ready).response.start)
        first.complete(Unit)
        assertEquals(LocalDate.parse("2026-11-04"), (holder.state.value.load as CalendarLoad.Ready).response.start)
    }

    @Test
    fun `subscription create shows the secret once and dismissing clears it`() {
        val repo = FakeCalendarRepository()
        val holder = CalendarSubscriptionHolder(scope, repo, message)
        holder.refresh()
        assertFalse(holder.state.value.status!!.active)

        holder.createOrRegenerate()
        assertEquals("token1", holder.state.value.created!!.token)
        assertTrue(holder.state.value.status!!.active)

        holder.dismissCreated()
        assertNull(holder.state.value.created)
        assertTrue(holder.state.value.status!!.active)

        holder.createOrRegenerate()
        assertEquals("token2", holder.state.value.created!!.token)
        assertEquals(2, repo.createCount)
    }

    @Test
    fun `opening the link panel fetches the existing link in one call when the server can show it`() {
        val repo = FakeCalendarRepository().apply { feed = CalendarFeedStatus(active = true, linkAvailable = true) }
        val holder = CalendarSubscriptionHolder(scope, repo, message)
        holder.ensureLink()
        assertEquals(1, repo.createCount)
        assertEquals(false, repo.lastRotate)
        assertEquals("token1", holder.state.value.created!!.token)
    }

    @Test
    fun `opening the link panel never replaces a link the server cannot show again`() {
        for (available in listOf(false, null)) {
            val repo = FakeCalendarRepository().apply { feed = CalendarFeedStatus(active = true, linkAvailable = available) }
            val holder = CalendarSubscriptionHolder(scope, repo, message)
            holder.ensureLink()
            assertEquals(0, repo.createCount)
            assertNull(holder.state.value.created)
        }
    }

    @Test
    fun `reset asks the server to rotate while first open does not`() {
        val repo = FakeCalendarRepository()
        val holder = CalendarSubscriptionHolder(scope, repo, message)
        holder.ensureLink()
        assertEquals(false, repo.lastRotate)
        holder.createOrRegenerate()
        assertEquals(true, repo.lastRotate)
    }

    private val snapshot = TitleSnapshot(kind = "series", title = "Test Series A", year = 2026)

    @Test
    fun `request and watchlist use the server snapshot and remember the outcome`() {
        val repo = FakeCalendarRepository()
        val actions = CalendarActionsHolder(scope, repo, message)
        actions.request(snapshot)
        assertEquals(listOf(snapshot), repo.requested)
        assertTrue(snapshot in actions.state.value.requested)

        actions.toggleWatchlist(snapshot, currentlyListed = false)
        assertEquals(listOf(snapshot to true), repo.watchlisted)
        assertEquals(true, actions.state.value.listed[snapshot])
        actions.toggleWatchlist(snapshot, currentlyListed = true)
        assertEquals(false, actions.state.value.listed[snapshot])
        assertTrue(actions.state.value.busy.isEmpty())
    }

    @Test
    fun `a failed request is reported and not remembered`() {
        val repo = FakeCalendarRepository().apply { failure = IOException("offline") }
        val actions = CalendarActionsHolder(scope, repo, message)
        actions.request(snapshot)
        assertNotNull(actions.state.value.error)
        assertFalse(snapshot in actions.state.value.requested)
    }

    @Test
    fun `an entry opens only through the server's enabled open action`() {
        val base = entry("a", "2026-10-05")
        assertNull(base.copy(workId = "w").openWorkId)
        val open = CalendarAction(CalendarAction.OPEN, enabled = true, workId = "w")
        assertEquals("w", base.copy(actions = listOf(open)).openWorkId)
        assertNull(base.copy(actions = listOf(open.copy(enabled = false))).openWorkId)
    }

    @Test
    fun `revoke deactivates and failures are reported without losing state`() {
        val repo = FakeCalendarRepository().apply { feed = CalendarFeedStatus(active = true) }
        val holder = CalendarSubscriptionHolder(scope, repo, message)
        holder.refresh()

        repo.failure = IOException("offline")
        holder.revoke()
        assertNotNull(holder.state.value.error)
        assertTrue(holder.state.value.status!!.active)

        repo.failure = null
        holder.revoke()
        assertEquals(1, repo.revokeCount)
        assertFalse(holder.state.value.status!!.active)
        assertFalse(holder.state.value.busy)
    }
}
