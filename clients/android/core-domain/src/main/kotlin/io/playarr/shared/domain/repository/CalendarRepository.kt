package io.playarr.shared.domain.repository

import io.playarr.shared.data.model.AvailabilityLag
import io.playarr.shared.data.model.CalendarFeedCreated
import io.playarr.shared.data.model.CalendarFeedStatus
import io.playarr.shared.data.model.CalendarResponse
import io.playarr.shared.data.remote.PlayarrApi
import java.time.LocalDate
import javax.inject.Inject

/** Aggregated release calendar, its external iCal subscription and per-work availability lag. */
interface CalendarRepository {
    /** Inclusive UTC days [start]..[end]; the server rejects spans over 92 days. */
    suspend fun calendar(start: LocalDate, end: LocalDate): CalendarResponse

    suspend fun feedStatus(): CalendarFeedStatus

    /** Creates or regenerates the subscription; the returned URL is the only time the secret is exposed. */
    suspend fun createFeed(): CalendarFeedCreated

    suspend fun revokeFeed()

    suspend fun availabilityLag(workId: String): AvailabilityLag
}

class DefaultCalendarRepository @Inject constructor(
    private val api: PlayarrApi,
) : CalendarRepository {
    override suspend fun calendar(start: LocalDate, end: LocalDate): CalendarResponse =
        api.getCalendar(start = start.toString(), end = end.toString())

    override suspend fun feedStatus(): CalendarFeedStatus = api.getCalendarFeed()

    override suspend fun createFeed(): CalendarFeedCreated = api.createCalendarFeed()

    override suspend fun revokeFeed() {
        val response = api.revokeCalendarFeed()
        if (!response.isSuccessful) throw retrofit2.HttpException(response)
    }

    override suspend fun availabilityLag(workId: String): AvailabilityLag = api.getAvailabilityLag(workId)
}
