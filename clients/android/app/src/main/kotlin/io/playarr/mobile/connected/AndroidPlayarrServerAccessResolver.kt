package io.playarr.mobile.connected

import io.playarr.shared.data.remote.PlayarrServerAccess
import io.playarr.shared.data.remote.PlayarrServerAccessResolver
import io.playarr.shared.download.db.DownloadMetadataDao
import java.net.URI
import javax.inject.Inject
import javax.inject.Singleton

/** Resolves joined resource ownership to a current, profile-scoped bearer token. */
@Singleton
internal class AndroidPlayarrServerAccessResolver internal constructor(
    private val clientsProvider: suspend () -> List<PlayarrServerClient>,
    private val registry: PlayarrServerSourceRegistry,
    private val downloadMetadataDao: DownloadMetadataDao,
) : PlayarrServerAccessResolver {

    @Inject
    constructor(
        clientProvider: PlayarrServerClientProvider,
        registry: PlayarrServerSourceRegistry,
        downloadMetadataDao: DownloadMetadataDao,
    ) : this(clientProvider::clients, registry, downloadMetadataDao)

    override suspend fun primary(): PlayarrServerAccess = activeClients().first().access()

    override suspend fun forWork(workId: String): PlayarrServerAccess {
        val clients = activeClients()
        return (registry.preferredWorkSource(workId) ?: registry.workSources(workId).firstOrNull())
            ?.server
            ?.access()
            ?: clients.first().access()
    }

    override suspend fun forMedia(mediaFileId: String): PlayarrServerAccess {
        val clients = activeClients()
        registry.mediaServer(mediaFileId)?.let { return it.access() }
        val persistedUrl = downloadMetadataDao.get(mediaFileId)?.serverUrl?.takeIf(String::isNotBlank)
        val persistedServer = persistedUrl?.let { url -> clients.firstOrNull { it.url.sameServer(url) } }
        if (persistedServer != null) {
            registry.registerMediaServer(mediaFileId, persistedServer)
            return persistedServer.access()
        }
        return persistedUrl?.let { PlayarrServerAccess(it, null) } ?: clients.first().access()
    }

    override suspend fun forDownloadTicket(ticketId: String): PlayarrServerAccess {
        val clients = activeClients()
        return registry.downloadTicketServer(ticketId)?.access() ?: clients.first().access()
    }

    override suspend fun forServerUrl(serverUrl: String): PlayarrServerAccess {
        val clients = activeClients()
        return clients.firstOrNull { it.url.sameServer(serverUrl) }?.access()
            ?: PlayarrServerAccess(serverUrl.trimEnd('/'), null)
    }

    override suspend fun refreshForServerUrl(
        serverUrl: String,
        rejectedAccessToken: String?,
    ): String? = activeClients().firstOrNull { it.url.sameServer(serverUrl) }
        ?.refreshAccessToken
        ?.invoke(rejectedAccessToken)

    private suspend fun activeClients(): List<PlayarrServerClient> =
        clientsProvider().also(registry::ensureScope)

    private suspend fun PlayarrServerClient.access(): PlayarrServerAccess =
        PlayarrServerAccess(url.trimEnd('/'), accessToken())

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
