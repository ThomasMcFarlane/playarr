package io.playarr.shared.data.events

import okhttp3.ResponseBody
import retrofit2.Call
import retrofit2.http.GET
import retrofit2.http.Header
import retrofit2.http.Streaming

/** Retrofit surface of the per-user live event stream. Always the signed-in primary server. */
interface LiveEventsApi {
    /**
     * Opens the stream. The raw response is not turned into a thrown error so the
     * caller can tell a supporting server (`200 text/event-stream`) from an
     * older one (HTML app shell or 404). Returned as a [Call] so a reader blocked
     * in the body can be unblocked with [Call.cancel] from another thread.
     */
    @Streaming
    @GET("api/v1/events")
    fun events(@Header("Last-Event-ID") lastEventId: String?): Call<ResponseBody>
}
