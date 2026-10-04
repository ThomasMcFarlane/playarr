package io.playarr.shared.data.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/** Request status values this client understands; unknown future values are kept verbatim. */
object RequestWire {
    const val STATUS_PENDING = "pending"
    const val STATUS_APPROVED = "approved"
    const val STATUS_DECLINED = "declined"
    const val STATUS_AVAILABLE = "available"
    const val STATUS_FAILED = "failed"
}

/** One row of `GET /api/v1/requests` (admins see every request, others only their own). */
@Serializable
data class RequestView(
    val id: String,
    val title: String,
    val kind: String = "",
    val year: Int? = null,
    @SerialName("poster_url") val posterUrl: String? = null,
    @SerialName("tmdb_id") val tmdbId: Long? = null,
    @SerialName("tvdb_id") val tvdbId: Long? = null,
    val seasons: List<Int> = emptyList(),
    val status: String,
    val origin: String = "playarr",
    /** Present only for the viewer's own requests or when the viewer is an admin. */
    @SerialName("requested_by") val requestedBy: String? = null,
    val mine: Boolean = false,
    @SerialName("status_note") val statusNote: String? = null,
    val systems: List<String> = emptyList(),
    @SerialName("created_at") val createdAt: String = "",
    @SerialName("updated_at") val updatedAt: String = "",
)
