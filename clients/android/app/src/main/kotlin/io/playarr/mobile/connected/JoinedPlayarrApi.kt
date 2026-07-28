package io.playarr.mobile.connected

import io.playarr.shared.data.model.CatalogPage
import io.playarr.shared.data.model.CreateDownloadTicketRequest
import io.playarr.shared.data.model.DownloadOptionsResponse
import io.playarr.shared.data.model.DownloadTicketResponse
import io.playarr.shared.data.model.ExternalProvider
import io.playarr.shared.data.model.MediaChapter
import io.playarr.shared.data.model.MediaMetadata
import io.playarr.shared.data.model.MediaPlaybackOptionsResponse
import io.playarr.shared.data.model.PlaybackEventRequest
import io.playarr.shared.data.model.PlaybackInfoResponse
import io.playarr.shared.data.model.SearchResponse
import io.playarr.shared.data.model.UpdateMediaPlaybackPreferencesRequest
import io.playarr.shared.data.model.UpdateWatchProgressRequest
import io.playarr.shared.data.model.WatchProgress
import io.playarr.shared.data.model.Work
import io.playarr.shared.data.model.WorkChildren
import io.playarr.shared.data.model.WorkCreditsResponse
import io.playarr.shared.data.model.WorkDetail
import io.playarr.shared.data.model.WorkKind
import io.playarr.shared.data.remote.PlayarrApi
import java.text.Normalizer
import java.util.Locale
import java.util.concurrent.ConcurrentHashMap
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope

internal data class PlayarrWorkSource(
    val server: PlayarrServerClient,
    val work: Work,
)

/** In-memory ownership registry used to route child media and sessions back to their server. */
internal class PlayarrServerSourceRegistry {
    private val sourcesByWorkId = ConcurrentHashMap<String, List<PlayarrWorkSource>>()
    private val preferredServerByWorkId = ConcurrentHashMap<String, PlayarrServerClient>()
    private val serverByMediaFileId = ConcurrentHashMap<String, PlayarrServerClient>()
    private val serverByPlaybackSessionId = ConcurrentHashMap<String, PlayarrServerClient>()
    private val serverByDownloadTicketId = ConcurrentHashMap<String, PlayarrServerClient>()
    @Volatile
    private var activeScope: String? = null
    @Volatile
    private var activeServerKeys: Set<String> = emptySet()

    @Synchronized
    fun ensureScope(servers: List<PlayarrServerClient>) {
        val scope = servers.joinToString(separator = "\u0000") { "${it.profileUserId}\u0001${it.url}" }
        if (activeScope == scope) return
        activeServerKeys = emptySet()
        sourcesByWorkId.clear()
        preferredServerByWorkId.clear()
        serverByMediaFileId.clear()
        serverByPlaybackSessionId.clear()
        serverByDownloadTicketId.clear()
        activeServerKeys = servers.mapTo(mutableSetOf()) { it.scopeKey() }
        activeScope = scope
    }

    fun workSources(workId: String): List<PlayarrWorkSource> = sourcesByWorkId[workId].orEmpty()

    fun preferredWorkSource(workId: String): PlayarrWorkSource? {
        val preferred = preferredServerByWorkId[workId] ?: return null
        return workSources(workId).firstOrNull { it.server.scopeKey() == preferred.scopeKey() }
    }

    @Synchronized
    fun preferWorkSource(source: PlayarrWorkSource, detail: WorkDetail) {
        if (!source.server.isActive()) return
        val selected = source.copy(work = detail.work)
        val sources = workSources(source.work.id).map { current ->
            if (current.server.scopeKey() == source.server.scopeKey()) selected else current
        }
        sources.forEach { current ->
            sourcesByWorkId[current.work.id] = sources
            preferredServerByWorkId[current.work.id] = source.server
        }
        sourcesByWorkId[detail.work.id] = sources
        preferredServerByWorkId[detail.work.id] = source.server
        registerDetail(source.server, detail)
    }

    @Synchronized
    fun registerWorkSources(sources: List<PlayarrWorkSource>): Work {
        val representative = sources.first().work
        val activeSources = sources.filter { it.server.isActive() }
        activeSources.forEach { sourcesByWorkId[it.work.id] = activeSources }
        if (activeSources.isNotEmpty()) sourcesByWorkId[representative.id] = activeSources
        return representative
    }

    @Synchronized
    fun registerDetail(server: PlayarrServerClient, detail: WorkDetail) {
        if (!server.isActive()) return
        detail.mediaFileId?.let { serverByMediaFileId[it] = server }
        when (val children = detail.children) {
            is WorkChildren.Series -> children.seasons.flatMap { it.episodes }.forEach {
                it.mediaFileId?.let { mediaFileId -> serverByMediaFileId[mediaFileId] = server }
            }
            is WorkChildren.Artist -> children.albums.flatMap { it.tracks }.forEach {
                it.mediaFileId?.let { mediaFileId -> serverByMediaFileId[mediaFileId] = server }
            }
            is WorkChildren.Author -> children.books.forEach {
                it.mediaFileId?.let { mediaFileId -> serverByMediaFileId[mediaFileId] = server }
            }
            WorkChildren.Movie -> Unit
        }
    }

    fun mediaServer(mediaFileId: String): PlayarrServerClient? = serverByMediaFileId[mediaFileId]
    @Synchronized
    fun registerMediaServer(mediaFileId: String, server: PlayarrServerClient) {
        if (server.isActive()) serverByMediaFileId[mediaFileId] = server
    }
    @Synchronized
    fun registerPlaybackSession(sessionId: String, server: PlayarrServerClient) {
        if (server.isActive()) serverByPlaybackSessionId[sessionId] = server
    }
    fun playbackSessionServer(sessionId: String): PlayarrServerClient? = serverByPlaybackSessionId[sessionId]
    @Synchronized
    fun registerDownloadTicket(ticket: DownloadTicketResponse, server: PlayarrServerClient) {
        if (!server.isActive()) return
        serverByDownloadTicketId[ticket.id] = server
        serverByMediaFileId[ticket.mediaFileId] = server
    }
    fun downloadTicketServer(ticketId: String): PlayarrServerClient? = serverByDownloadTicketId[ticketId]

    private fun PlayarrServerClient.isActive(): Boolean = scopeKey() in activeServerKeys
    private fun PlayarrServerClient.scopeKey(): String = "$profileUserId\u0001$url"
}

/**
 * Android counterpart of Web's joined client. Operations Web leaves primary-only are inherited
 * through interface delegation; catalogue and source-owned media operations are overridden here.
 */
internal class JoinedPlayarrApi(
    private val primary: PlayarrApi,
    private val clientsProvider: suspend () -> List<PlayarrServerClient>,
    private val registry: PlayarrServerSourceRegistry,
) : PlayarrApi by primary {

    override suspend fun browseCatalog(
        kind: String?,
        availableOnly: Boolean?,
        genre: String?,
        tag: String?,
        sort: String?,
        limit: Long?,
        offset: Long?,
    ): CatalogPage {
        val clients = clients()
        if (clients.size == 1) {
            return primary.browseCatalog(kind, availableOnly, genre, tag, sort, limit, offset)
        }
        val requestedOffset = offset ?: 0L
        val requestedLimit = limit ?: 50L
        val fetchLimit = (requestedOffset + requestedLimit).coerceAtLeast(0L)
        val pages = successfulAcross(clients) { server ->
            server.api.browseCatalog(kind, availableOnly, genre, tag, sort, fetchLimit, 0)
        }
        val joined = joinWorks(pages.map { (server, page) -> server to page.items })
            .sortedWith(playarrWorkComparator(sort))
        return CatalogPage(
            items = joined.drop(requestedOffset.safeIndex()).take(requestedLimit.safeIndex()),
            total = pages.sumOf { (_, page) -> page.total ?: page.items.size.toLong() },
        )
    }

    override suspend fun searchCatalog(query: String, limit: Long?): SearchResponse {
        val clients = clients()
        if (clients.size == 1) return primary.searchCatalog(query, limit)
        val requestedLimit = limit ?: 50L
        val rows = successfulAcross(clients) { it.api.searchCatalog(query, requestedLimit) }
        return SearchResponse(
            items = joinWorks(rows.map { (server, response) -> server to response.items })
                .take(requestedLimit.safeIndex()),
        )
    }

    override suspend fun listCatalogKinds(): List<WorkKind> {
        val clients = clients()
        if (clients.size == 1) return primary.listCatalogKinds()
        return successfulAcross(clients) { it.api.listCatalogKinds() }
            .flatMap { it.second }
            .distinct()
    }

    override suspend fun getWork(id: String): WorkDetail {
        val clients = clients()
        val known = registry.workSources(id)
        if (known.isNotEmpty()) {
            val source = known.first()
            return source.server.api.getWork(source.work.id).also { registry.registerDetail(source.server, it) }
        }
        val resolved = successfulAcross(clients) { it.api.getWork(id) }.first()
        registry.registerDetail(resolved.first, resolved.second)
        val targetKeys = resolved.second.work.identityKeys().toSet()
        val matches = availableAcross(clients) { it.api.searchCatalog(resolved.second.work.title, 50) }
            .flatMap { (server, works) ->
                works.items.filter { work -> work.identityKeys().any(targetKeys::contains) }
                    .map { work -> PlayarrWorkSource(server, work) }
            }
        registry.registerWorkSources(
            (listOf(PlayarrWorkSource(resolved.first, resolved.second.work)) + matches)
                .distinctBy { it.server.url },
        )
        return resolved.second
    }

    override suspend fun getWorkCredits(id: String): WorkCreditsResponse {
        clients()
        val source = registry.workSources(id).firstOrNull()
        return (source?.server?.api ?: primary).getWorkCredits(source?.work?.id ?: id)
    }

    override suspend fun getSimilarWorks(id: String, limit: Long?): List<Work> {
        val clients = clients()
        val source = registry.workSources(id).firstOrNull()
        val server = source?.server ?: clients.first()
        return joinWorks(listOf(server to server.api.getSimilarWorks(source?.work?.id ?: id, limit)))
    }

    override suspend fun getPlaybackInfo(
        mediaFileId: String,
        containers: String?,
        videoCodecs: String?,
        audioCodecs: String?,
        maxBitrateBps: Long?,
        profile: String?,
        forceTranscode: Boolean?,
        startPositionMs: Long?,
        audioStreamIndex: Int?,
        ignoreSavedPreferences: Boolean?,
    ): PlaybackInfoResponse {
        val server = serverForMedia(mediaFileId)
        return server.api.getPlaybackInfo(
            mediaFileId,
            containers,
            videoCodecs,
            audioCodecs,
            maxBitrateBps,
            profile,
            forceTranscode,
            startPositionMs,
            audioStreamIndex,
            ignoreSavedPreferences,
        ).also { response ->
            response.sessionId?.let { registry.registerPlaybackSession(it, server) }
        }
    }

    override suspend fun recordPlaybackEvent(sessionId: String, request: PlaybackEventRequest) {
        clients()
        (registry.playbackSessionServer(sessionId)?.api ?: primary).recordPlaybackEvent(sessionId, request)
    }

    override suspend fun listWatchProgress(): List<WatchProgress> {
        val clients = clients()
        if (clients.size == 1) return primary.listWatchProgress()
        return successfulAcross(clients) { it.api.listWatchProgress() }.flatMap { it.second }
    }

    override suspend fun getWatchProgress(mediaFileId: String): WatchProgress =
        serverForMedia(mediaFileId).api.getWatchProgress(mediaFileId)

    override suspend fun updateWatchProgress(
        mediaFileId: String,
        request: UpdateWatchProgressRequest,
    ): WatchProgress = serverForMedia(mediaFileId).api.updateWatchProgress(mediaFileId, request)

    override suspend fun getMediaChapters(mediaFileId: String): List<MediaChapter> =
        serverForMedia(mediaFileId).api.getMediaChapters(mediaFileId)

    override suspend fun getMediaMetadata(mediaFileId: String): MediaMetadata =
        serverForMedia(mediaFileId).api.getMediaMetadata(mediaFileId)

    override suspend fun getMediaPlaybackOptions(mediaFileId: String): MediaPlaybackOptionsResponse =
        serverForMedia(mediaFileId).api.getMediaPlaybackOptions(mediaFileId)

    override suspend fun updateMediaPlaybackOptions(
        mediaFileId: String,
        request: UpdateMediaPlaybackPreferencesRequest,
    ): MediaPlaybackOptionsResponse = serverForMedia(mediaFileId).api.updateMediaPlaybackOptions(mediaFileId, request)

    override suspend fun getDownloadOptions(mediaFileId: String): DownloadOptionsResponse =
        serverForMedia(mediaFileId).api.getDownloadOptions(mediaFileId)

    override suspend fun createDownloadTicket(request: CreateDownloadTicketRequest): DownloadTicketResponse {
        val server = serverForMedia(request.mediaFileId)
        return server.api.createDownloadTicket(request).also { registry.registerDownloadTicket(it, server) }
    }

    override suspend fun listDownloadTickets(): List<DownloadTicketResponse> {
        val clients = clients()
        if (clients.size == 1) return primary.listDownloadTickets()
        return successfulAcross(clients) { server -> server.api.listDownloadTickets() }
            .flatMap { (server, tickets) -> tickets.onEach { registry.registerDownloadTicket(it, server) } }
    }

    override suspend fun getDownloadTicket(id: String): DownloadTicketResponse {
        val clients = clients()
        registry.downloadTicketServer(id)?.let { server ->
            return server.api.getDownloadTicket(id).also { registry.registerDownloadTicket(it, server) }
        }
        val resolved = successfulAcross(clients) { it.api.getDownloadTicket(id) }.first()
        return resolved.second.also { registry.registerDownloadTicket(it, resolved.first) }
    }

    override suspend fun cancelDownloadTicket(id: String) = clients().let { clients ->
        val server = registry.downloadTicketServer(id) ?: successfulAcross(clients) {
            it.api.getDownloadTicket(id)
        }.first().also { (owner, ticket) -> registry.registerDownloadTicket(ticket, owner) }.first
        server.api.cancelDownloadTicket(id)
    }

    private suspend fun serverForMedia(mediaFileId: String): PlayarrServerClient {
        val clients = clients()
        return registry.mediaServer(mediaFileId) ?: clients.first()
    }

    private suspend fun clients(): List<PlayarrServerClient> = clientsProvider().also(registry::ensureScope)

    private fun joinWorks(rows: List<Pair<PlayarrServerClient, List<Work>>>): List<Work> {
        val groups = mutableListOf<MutableList<PlayarrWorkSource>>()
        val groupByIdentity = mutableMapOf<String, MutableList<PlayarrWorkSource>>()
        rows.forEach { (server, works) ->
            works.forEach { work ->
                val matching = work.identityKeys().mapNotNull(groupByIdentity::get).distinctBy { System.identityHashCode(it) }
                val source = PlayarrWorkSource(server, work)
                val group = matching.firstOrNull() ?: mutableListOf<PlayarrWorkSource>().also(groups::add)
                if (group.none { it.server.url == server.url }) group += source
                matching.drop(1).forEach { merged ->
                    if (merged !== group) {
                        group += merged
                        groups.removeAll { it === merged }
                    }
                }
                group.forEach { member -> member.work.identityKeys().forEach { groupByIdentity[it] = group } }
            }
        }
        return groups.map { registry.registerWorkSources(it) }
    }

    private suspend fun <T> successfulAcross(
        clients: List<PlayarrServerClient>,
        request: suspend (PlayarrServerClient) -> T,
    ): List<Pair<PlayarrServerClient, T>> {
        val results = settledAcross(clients, request)
        val successes = results.mapNotNull { (server, result) -> result.getOrNull()?.let { server to it } }
        if (successes.isEmpty()) throw results.first().second.exceptionOrNull() ?: IllegalStateException("No connected server returned a response.")
        return successes
    }

    private suspend fun <T> availableAcross(
        clients: List<PlayarrServerClient>,
        request: suspend (PlayarrServerClient) -> T,
    ): List<Pair<PlayarrServerClient, T>> = settledAcross(clients, request)
        .mapNotNull { (server, result) -> result.getOrNull()?.let { server to it } }

    private suspend fun <T> settledAcross(
        clients: List<PlayarrServerClient>,
        request: suspend (PlayarrServerClient) -> T,
    ): List<Pair<PlayarrServerClient, Result<T>>> = coroutineScope {
        val results = clients.map { server ->
            async {
                server to try {
                    Result.success(request(server))
                } catch (cancelled: CancellationException) {
                    throw cancelled
                } catch (failure: Throwable) {
                    Result.failure(failure)
                }
            }
        }.awaitAll()
        results
    }
}

private fun Work.identityKeys(): List<String> = externalRefs.map { reference ->
    "external:${reference.provider.key()}:${reference.externalId.trim().lowercase(Locale.ROOT)}"
}.ifEmpty {
    val normalizedTitle = Normalizer.normalize(title, Normalizer.Form.NFKC).trim().lowercase(Locale.ROOT)
    listOf("fallback:${kind.name.lowercase(Locale.ROOT)}:$normalizedTitle:${releaseDate?.toString()?.take(4).orEmpty()}")
}

private fun ExternalProvider.key(): String = when (this) {
    ExternalProvider.Tmdb -> "tmdb"
    ExternalProvider.Tvdb -> "tvdb"
    ExternalProvider.Imdb -> "imdb"
    ExternalProvider.MusicBrainzArtist -> "musicbrainz_artist"
    ExternalProvider.MusicBrainzReleaseGroup -> "musicbrainz_release_group"
    ExternalProvider.Goodreads -> "goodreads"
    ExternalProvider.Isbn -> "isbn"
    ExternalProvider.Asin -> "asin"
    ExternalProvider.Tpdb -> "tpdb"
    is ExternalProvider.Other -> "other:${name.lowercase(Locale.ROOT)}"
}

private fun playarrWorkComparator(sort: String?): Comparator<Work> = when (sort) {
    "recent", "date_added" -> compareByDescending(Work::addedAt)
    else -> compareBy { it.sortTitle.lowercase(Locale.ROOT) }
}

private fun Long.safeIndex(): Int = coerceIn(0L, Int.MAX_VALUE.toLong()).toInt()
