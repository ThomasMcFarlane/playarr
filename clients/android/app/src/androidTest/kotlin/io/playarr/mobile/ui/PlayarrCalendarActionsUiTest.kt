package io.playarr.mobile.ui

import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import io.playarr.shared.data.model.AvailabilityLag
import io.playarr.shared.data.model.CalendarAction
import io.playarr.shared.data.model.CalendarEntry
import io.playarr.shared.data.model.CalendarFeedCreated
import io.playarr.shared.data.model.CalendarFeedStatus
import io.playarr.shared.data.model.CalendarResponse
import io.playarr.shared.data.model.TitleSnapshot
import io.playarr.shared.domain.repository.CalendarRepository
import java.time.LocalDate
import java.time.ZoneOffset
import java.util.Locale
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

/** Calendar details show exactly the actions the server enabled, including Watchlist beside Open. */
class PlayarrCalendarActionsUiTest {
    @get:Rule
    val compose = createComposeRule()

    private class Repo : CalendarRepository {
        val watchlisted = mutableListOf<Pair<TitleSnapshot, Boolean>>()
        override suspend fun calendar(start: LocalDate, end: LocalDate) = CalendarResponse(start, end)
        override suspend fun feedStatus() = CalendarFeedStatus(active = false)
        override suspend fun requestTitle(snapshot: TitleSnapshot) = Unit
        override suspend fun setWatchlisted(snapshot: TitleSnapshot, listed: Boolean) {
            watchlisted += snapshot to listed
        }
        override suspend fun createFeed(rotate: Boolean): CalendarFeedCreated = error("unused")
        override suspend fun revokeFeed() = Unit
        override suspend fun availabilityLag(workId: String) = AvailabilityLag()
    }

    private val unaired = CalendarEntry(
        id = "episode:s3e3",
        mediaKind = "episode",
        releaseType = "air",
        title = "Sample Series 1",
        subtitle = "Upcoming episode",
        date = LocalDate.parse("2026-10-09"),
        monitored = true,
        workId = "work-1",
        snapshot = TitleSnapshot(kind = "series", title = "Sample Series 1", workId = "work-1"),
        actions = listOf(
            CalendarAction(CalendarAction.OPEN, enabled = true, workId = "work-1"),
            CalendarAction(CalendarAction.WATCHLIST, enabled = true),
        ),
    )

    @Test
    fun watchlistIsOfferedBesideOpenWhenTheServerEnablesBoth() {
        val repo = Repo()
        val holder = CalendarActionsHolder(CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate), repo)
        compose.setContent {
            CalendarItemDetails(CalendarItem.Single(unaired), Locale.ENGLISH, ZoneOffset.UTC, onOpenWork = {}, actions = holder)
        }
        compose.onNodeWithText("Open").assertExists()
        compose.onNodeWithText("Add to watchlist").performClick()
        compose.waitUntil(3_000) { repo.watchlisted.isNotEmpty() }
        assertEquals(listOf(unaired.snapshot!! to true), repo.watchlisted)
    }
}
