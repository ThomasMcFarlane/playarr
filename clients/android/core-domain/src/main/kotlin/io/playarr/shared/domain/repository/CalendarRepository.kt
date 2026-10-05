package io.playarr.shared.domain.repository

import io.playarr.shared.data.model.AvailabilityLag
import io.playarr.shared.data.model.CalendarFeedCreated
import io.playarr.shared.data.model.CalendarFeedStatus
import io.playarr.shared.data.model.CalendarResponse
import io.playarr.shared.data.model.TitleSnapshot
import io.playarr.shared.data.remote.PlayarrApi
import java.time.LocalDate
import javax.inject.Inject

/** Aggregated release calendar, its external iCal subscription and per-work availability lag. */
interface CalendarRepository {
    /** Inclusive UTC days [start]..[end]; the server rejects spans over 92 days. */
    suspend fun calendar(start: LocalDate, end: LocalDate): CalendarResponse

    suspend fun feedStatus(): CalendarFeedStatus

    /** The existing subscription link or a new one; [rotate] replaces it (the old URL stops working). */
    suspend fun createFeed(rotate: Boolean = false): CalendarFeedCreated

    /** `POST /api/v1/discover/request` with the entry's server-built [snapshot]. */
    suspend fun requestTitle(snapshot: TitleSnapshot)

    /** Adds [snapshot] to, or removes it from, the user's watchlist. */
    suspend fun setWatchlisted(snapshot: TitleSnapshot, listed: Boolean)

    suspend fun revokeFeed()

    suspend fun availabilityLag(workId: String): AvailabilityLag
}

class DefaultCalendarRepository @Inject constructor(
    private val api: PlayarrApi,
) : CalendarRepository {
    override suspend fun calendar(start: LocalDate, end: LocalDate): CalendarResponse =
        api.getCalendar(start = start.toString(), end = end.toString())

    override suspend fun feedStatus(): CalendarFeedStatus = api.getCalendarFeed()

    override suspend fun createFeed(rotate: Boolean): CalendarFeedCreated =
        api.createCalendarFeed(rotate = if (rotate) true else null)

    override suspend fun requestTitle(snapshot: TitleSnapshot) {
        api.requestTitle(snapshot)
    }

    override suspend fun setWatchlisted(snapshot: TitleSnapshot, listed: Boolean) {
        if (listed) {
            api.addToWatchlist(snapshot)
        } else {
            val response = api.removeFromWatchlist(api.resolveTitle(snapshot).title.titleKey)
            if (!response.isSuccessful) throw retrofit2.HttpException(response)
        }
    }

    override suspend fun revokeFeed() {
        val response = api.revokeCalendarFeed()
        if (!response.isSuccessful) throw retrofit2.HttpException(response)
    }

    override suspend fun availabilityLag(workId: String): AvailabilityLag = api.getAvailabilityLag(workId)
}
