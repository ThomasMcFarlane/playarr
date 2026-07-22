package io.streamarr.shared.data.remote

/** The authenticated server origin that owns a joined-catalogue resource. */
data class StreamarrServerAccess(
    val serverUrl: String,
    val accessToken: String?,
)

/**
 * Resolves joined-catalogue ownership without exposing stored secondary credentials. Callers use
 * the returned token immediately; every resolution reads the current rotating session value.
 */
interface StreamarrServerAccessResolver {
    suspend fun primary(): StreamarrServerAccess
    suspend fun forWork(workId: String): StreamarrServerAccess
    suspend fun forMedia(mediaFileId: String): StreamarrServerAccess
    suspend fun forDownloadTicket(ticketId: String): StreamarrServerAccess
    suspend fun forServerUrl(serverUrl: String): StreamarrServerAccess
    suspend fun refreshForServerUrl(serverUrl: String, rejectedAccessToken: String?): String?
}
