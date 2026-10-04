package io.playarr.shared.data.events

import okhttp3.ResponseBody
import retrofit2.Response
import retrofit2.http.GET
import retrofit2.http.Header
import retrofit2.http.Streaming

/** Retrofit surface of the per-user live event stream. Always the signed-in primary server. */
interface LiveEventsApi {
    /**
     * Opens the stream. Returns the raw [Response] (not a thrown error) so the
     * caller can tell a supporting server (`200 text/event-stream`) from an
     * older one (HTML app shell or 404).
     */
    @Streaming
    @GET("api/v1/events")
    suspend fun events(@Header("Last-Event-ID") lastEventId: String?): Response<ResponseBody>
}
