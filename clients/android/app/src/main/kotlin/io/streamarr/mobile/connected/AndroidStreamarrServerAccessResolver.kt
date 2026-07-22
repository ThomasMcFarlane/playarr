package io.streamarr.mobile.connected

import io.streamarr.shared.data.remote.StreamarrServerAccess
import io.streamarr.shared.data.remote.StreamarrServerAccessResolver
import io.streamarr.shared.download.db.DownloadMetadataDao
import java.net.URI
import javax.inject.Inject
import javax.inject.Singleton

/** Resolves joined resource ownership to a current, profile-scoped bearer token. */
@Singleton
internal class AndroidStreamarrServerAccessResolver internal constructor(
    private val clientsProvider: suspend () -> List<PlayarrServerClient>,
    private val registry: PlayarrServerSourceRegistry,
    private val downloadMetadataDao: DownloadMetadataDao,
) : StreamarrServerAccessResolver {

    @Inject
    constructor(
        clientProvider: PlayarrServerClientProvider,
        registry: PlayarrServerSourceRegistry,
        downloadMetadataDao: DownloadMetadataDao,
    ) : this(clientProvider::clients, registry, downloadMetadataDao)

    override suspend fun primary(): StreamarrServerAccess = activeClients().first().access()

    override suspend fun forWork(workId: String): StreamarrServerAccess {
        val clients = activeClients()
        return (registry.preferredWorkSource(workId) ?: registry.workSources(workId).firstOrNull())
            ?.server
            ?.access()
            ?: clients.first().access()
    }

    override suspend fun forMedia(mediaFileId: String): StreamarrServerAccess {
        val clients = activeClients()
        registry.mediaServer(mediaFileId)?.let { return it.access() }
        val persistedUrl = downloadMetadataDao.get(mediaFileId)?.serverUrl?.takeIf(String::isNotBlank)
        val persistedServer = persistedUrl?.let { url -> clients.firstOrNull { it.url.sameServer(url) } }
        if (persistedServer != null) {
            registry.registerMediaServer(mediaFileId, persistedServer)
            return persistedServer.access()
        }
        return persistedUrl?.let { StreamarrServerAccess(it, null) } ?: clients.first().access()
    }

    override suspend fun forDownloadTicket(ticketId: String): StreamarrServerAccess {
        val clients = activeClients()
        return registry.downloadTicketServer(ticketId)?.access() ?: clients.first().access()
    }

    override suspend fun forServerUrl(serverUrl: String): StreamarrServerAccess {
        val clients = activeClients()
        return clients.firstOrNull { it.url.sameServer(serverUrl) }?.access()
            ?: StreamarrServerAccess(serverUrl.trimEnd('/'), null)
    }

    override suspend fun refreshForServerUrl(
        serverUrl: String,
        rejectedAccessToken: String?,
    ): String? = activeClients().firstOrNull { it.url.sameServer(serverUrl) }
        ?.refreshAccessToken
        ?.invoke(rejectedAccessToken)

    private suspend fun activeClients(): List<PlayarrServerClient> =
        clientsProvider().also(registry::ensureScope)

    private suspend fun PlayarrServerClient.access(): StreamarrServerAccess =
        StreamarrServerAccess(url.trimEnd('/'), accessToken())

    private fun String.sameServer(other: String): Boolean = serverOrigin() == other.serverOrigin()

    private fun String.serverOrigin(): Triple<String?, String?, Int> = runCatching {
        val uri = URI(trim())
        Triple(uri.scheme?.lowercase(), uri.host?.lowercase(), uri.port.takeIf { it >= 0 } ?: when (uri.scheme) {
            "http" -> 80
            "https" -> 443
            else -> -1
        })
    }.getOrElse { Triple(null, trimEnd('/'), -1) }
}
