package io.playarr.shared.data.remote

/** The authenticated server origin that owns a joined-catalogue resource. */
data class PlayarrServerAccess(
    val serverUrl: String,
    val accessToken: String?,
)

/**
 * Resolves joined-catalogue ownership without exposing stored secondary credentials. Callers use
 * the returned token immediately; every resolution reads the current rotating session value.
 */
interface PlayarrServerAccessResolver {
    suspend fun primary(): PlayarrServerAccess
    suspend fun forWork(workId: String): PlayarrServerAccess
    suspend fun forMedia(mediaFileId: String): PlayarrServerAccess
    suspend fun forDownloadTicket(ticketId: String): PlayarrServerAccess
    suspend fun forServerUrl(serverUrl: String): PlayarrServerAccess
    suspend fun refreshForServerUrl(serverUrl: String, rejectedAccessToken: String?): String?
}
