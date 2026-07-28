package io.playarr.shared.download

import android.net.Uri
import androidx.media3.datasource.cache.Cache
import androidx.media3.exoplayer.offline.Download
import androidx.media3.exoplayer.offline.DownloadManager
import androidx.media3.exoplayer.offline.DownloadRequest
import io.playarr.shared.data.model.CreateDownloadTicketRequest
import io.playarr.shared.data.model.DownloadQualityOption
import io.playarr.shared.data.model.WatchState
import io.playarr.shared.data.remote.PlayarrApi
import io.playarr.shared.data.remote.PlayarrServerAccessResolver
import io.playarr.shared.download.db.DownloadMetadataDao
import io.playarr.shared.download.db.DownloadMetadataEntity
import io.playarr.shared.download.db.PendingProgressDao
import java.io.File
import java.net.URLEncoder
import java.nio.charset.StandardCharsets
import java.time.Instant
import javax.inject.Inject
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * Local, offline-playable downloads of media the caller already has
 * playback access to -- built on Media3's own offline-download stack
 * (`androidx.media3.exoplayer.offline.DownloadManager`/`DownloadService`/
 * `DownloadIndex`), not a hand-rolled OkHttp+Range downloader, so that both
 * direct-file and (if the server ever stages an HLS-manifest-shaped
 * download ticket) HLS downloads are resumable and survive the app leaving
 * the foreground via `DownloadService`'s own foreground-service mechanism.
 *
 * Media3's `DownloadIndex` (reachable through the injected [DownloadManager])
 * remains the sole source of truth for byte progress/state; this
 * repository's own Room-backed store ([DownloadMetadataDao]) holds only
 * what `DownloadIndex` doesn't: display metadata (title/poster/work) and
 * the Keep-until policy, keyed by `mediaFileId`, plus the server ticket id
 * a given download's bytes came from.
 */
interface DownloadRepository {
    /** Every locally-tracked download, live-merged from Room metadata + Media3's `DownloadManager`. */
    fun observeDownloads(): Flow<List<DownloadEntity>>

    /** `GET /api/v1/media/{media_file_id}/download-options`. */
    suspend fun listQualityOptions(mediaFileId: String): List<DownloadQualityOption>

    /**
     * Stages a server ticket and enqueues a Media3 download for each
     * candidate at [qualityId]. Best-effort per candidate: one candidate
     * failing to stage (e.g. its library ACL narrowed mid-batch) does not
     * abort the rest of a season/album "download all".
     */
    suspend fun enqueue(
        candidates: List<DownloadCandidate>,
        qualityId: String,
        keepUntil: KeepUntilSelection,
        qualityLabel: String = qualityId,
    )

    fun pause(mediaFileId: String)
    fun resume(mediaFileId: String)

    /** Removes the local download and best-effort cancels its server ticket. */
    fun cancel(mediaFileId: String)

    suspend fun setKeepUntil(mediaFileId: String, keepUntil: KeepUntilSelection)

    /**
     * A real [File] only when [mediaFileId]'s completed download is cached
     * as one contiguous Media3 cache span covering the whole file --
     * otherwise `null`, so callers fall back to network playback. Media3's
     * cache model has no first-class "give me one flat file" API: a
     * download interrupted and resumed at different offsets can leave its
     * content split across multiple adjacent cache-span files rather than
     * one, and this deliberately does not attempt to stitch/copy those
     * into a single file on the caller's behalf.
     */
    suspend fun localFile(mediaFileId: String): File?

    /** Removes every download whose Keep-until has passed. Called from `KeepUntilSweepWorker`'s periodic tick. */
    suspend fun sweepExpired()
}

class DefaultDownloadRepository @Inject constructor(
    private val api: PlayarrApi,
    private val serverAccessResolver: PlayarrServerAccessResolver,
    private val dao: DownloadMetadataDao,
    private val pendingProgressDao: PendingProgressDao,
    private val downloadManager: DownloadManager,
    private val cache: Cache,
    private val serviceStarter: PlayarrDownloadServiceStarter,
) : DownloadRepository {

    // pause/resume/cancel are deliberately plain (non-suspend) calls so a
    // Compose IconButton's onClick can call them directly; their DB/network
    // side effects run on this repository-owned scope instead. Scoped to
    // this @Singleton's own lifecycle (the app process), same reasoning
    // PlayarrMobileApp's own top-level scope uses.
    private val repositoryScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    override fun observeDownloads(): Flow<List<DownloadEntity>> {
        val media3Downloads = downloadManagerUpdates()
        return combine(dao.observeAll(), media3Downloads) { metadataRows, media3ById ->
            metadataRows.map { metadata ->
                val download = media3ById[metadata.mediaFileId]
                DownloadEntity(
                    mediaFileId = metadata.mediaFileId,
                    workId = metadata.workId,
                    title = metadata.title,
                    workTitle = metadata.workTitle,
                    posterUrl = metadata.posterUrl,
                    kind = metadata.kind,
                    qualityId = metadata.qualityId,
                    qualityLabel = metadata.qualityLabel.ifBlank { metadata.qualityId },
                    ticketId = metadata.ticketId,
                    serverUrl = metadata.serverUrl,
                    state = download?.state?.toDownloadState() ?: DownloadState.Queued,
                    bytesDownloaded = download?.bytesDownloaded ?: 0L,
                    totalBytes = download?.contentLength?.takeIf { it > 0 },
                    keepUntilEpochMillis = metadata.keepUntilEpochMillis,
                    keepUntilSelection = metadata.keepUntilSelection(),
                    failureMessage = download?.failureMessageOrNull(),
                    addedAtEpochMillis = metadata.addedAtEpochMillis,
                )
            }
        }
    }

    /** Re-emits the full current `Download` list (keyed by `mediaFileId`) on every Media3 change. */
    private fun downloadManagerUpdates(): Flow<Map<String, Download>> = callbackFlow {
        fun emitCurrent() {
            trySend(downloadManager.currentDownloads.associateBy { it.request.id })
        }
        val listener = object : DownloadManager.Listener {
            override fun onDownloadChanged(downloadManager: DownloadManager, download: Download, finalException: Exception?) = emitCurrent()
            override fun onDownloadRemoved(downloadManager: DownloadManager, download: Download) = emitCurrent()
            override fun onInitialized(downloadManager: DownloadManager) = emitCurrent()
        }
        downloadManager.addListener(listener)
        emitCurrent()
        awaitClose { downloadManager.removeListener(listener) }
    }

    override suspend fun listQualityOptions(mediaFileId: String): List<DownloadQualityOption> =
        api.getDownloadOptions(mediaFileId).options

    override suspend fun enqueue(
        candidates: List<DownloadCandidate>,
        qualityId: String,
        keepUntil: KeepUntilSelection,
        qualityLabel: String,
    ) {
        val now = System.currentTimeMillis()
        val policy = keepUntil.persistedDownloadPolicy()
        for (candidate in candidates) {
            // Best-effort fan-out (see this method's KDoc): a candidate
            // that fails to stage is skipped, not fatal to the batch.
            val ticket = runCatching {
                api.createDownloadTicket(CreateDownloadTicketRequest(candidate.mediaFileId, qualityId))
            }.getOrNull() ?: continue

            val serverAccess = serverAccessResolver.forDownloadTicket(ticket.id)
            val uri = Uri.parse(downloadTicketFileUrl(serverAccess.serverUrl, ticket.id))
            val request = DownloadRequest.Builder(candidate.mediaFileId, uri)
                .setCustomCacheKey(candidate.mediaFileId)
                .build()

            dao.upsert(
                DownloadMetadataEntity(
                    mediaFileId = candidate.mediaFileId,
                    workId = candidate.workId,
                    title = candidate.title,
                    workTitle = candidate.workTitle,
                    posterUrl = candidate.posterUrl,
                    kind = candidate.kind,
                    qualityId = qualityId,
                    qualityLabel = qualityLabel,
                    ticketId = ticket.id,
                    serverUrl = serverAccess.serverUrl,
                    keepUntilEpochMillis = policy.epochMillis,
                    keepUntilAmount = policy.amount,
                    keepUntilUnit = policy.unit,
                    watchedAtEpochMillis = null,
                    addedAtEpochMillis = now,
                ),
            )
            serviceStarter.addDownload(request)
        }
    }

    override fun pause(mediaFileId: String) {
        serviceStarter.setStopReason(mediaFileId, STOP_REASON_PAUSED_BY_USER)
    }

    override fun resume(mediaFileId: String) {
        serviceStarter.setStopReason(mediaFileId, Download.STOP_REASON_NONE)
    }

    override fun cancel(mediaFileId: String) {
        serviceStarter.removeDownload(mediaFileId)
        repositoryScope.launch {
            dao.get(mediaFileId)?.ticketId?.let { ticketId ->
                runCatching { api.cancelDownloadTicket(ticketId) }
            }
            dao.delete(mediaFileId)
        }
    }

    override suspend fun setKeepUntil(mediaFileId: String, keepUntil: KeepUntilSelection) {
        val policy = keepUntil.persistedDownloadPolicy()
        dao.updateKeepUntil(
            mediaFileId = mediaFileId,
            keepUntilEpochMillis = policy.epochMillis,
            keepUntilAmount = policy.amount,
            keepUntilUnit = policy.unit,
            watchedAtEpochMillis = null,
        )
    }

    override suspend fun localFile(mediaFileId: String): File? = withContext(Dispatchers.IO) {
        val download = downloadManager.currentDownloads.firstOrNull { it.request.id == mediaFileId }
            ?: runCatching { downloadManager.downloadIndex.getDownload(mediaFileId) }.getOrNull()
            ?: return@withContext null
        if (download.state != Download.STATE_COMPLETED) return@withContext null

        val totalBytes = download.contentLength.takeIf { it > 0 } ?: download.bytesDownloaded
        if (totalBytes <= 0) return@withContext null

        val cacheKey = download.request.customCacheKey ?: download.request.uri.toString()
        val spans = cache.getCachedSpans(cacheKey)
        val onlySpan = spans.singleOrNull() ?: return@withContext null
        if (onlySpan.position != 0L || onlySpan.length != totalBytes) return@withContext null
        onlySpan.file
    }

    override suspend fun sweepExpired() {
        val now = System.currentTimeMillis()
        val rows = dao.getAllOnce()
        val pendingWatchedAt = pendingProgressDao.getAll()
            .asSequence()
            .filter { it.completed }
            .groupBy { it.mediaFileId }
            .mapValues { (_, values) -> values.minOf { it.occurredAtEpochMillis } }
        val serverWatchedAt = runCatching { api.listWatchProgress() }
            .getOrDefault(emptyList())
            .asSequence()
            .filter { it.state == WatchState.Watched }
            .associate { progress ->
                progress.mediaFileId to (
                    progress.updatedAt?.let { runCatching { Instant.parse(it).toEpochMilli() }.getOrNull() }
                        ?: now
                    )
            }
        val resolvedRows = rows.map { row ->
            if (row.keepUntilAmount == null || row.watchedAtEpochMillis != null) return@map row
            val watchedAt = pendingWatchedAt[row.mediaFileId] ?: serverWatchedAt[row.mediaFileId] ?: return@map row
            dao.updateWatchedAt(row.mediaFileId, watchedAt)
            row.copy(watchedAtEpochMillis = watchedAt)
        }
        resolvedRows
            .filter { it.downloadExpiryEpochMillis()?.let { expiry -> expiry <= now } == true }
            .filter { metadata ->
                val download = downloadManager.currentDownloads.firstOrNull { it.request.id == metadata.mediaFileId }
                    ?: runCatching { downloadManager.downloadIndex.getDownload(metadata.mediaFileId) }.getOrNull()
                download?.state == Download.STATE_COMPLETED
            }
            .forEach { expired ->
                serviceStarter.removeDownload(expired.mediaFileId)
                expired.ticketId?.let { ticketId -> runCatching { api.cancelDownloadTicket(ticketId) } }
                dao.delete(expired.mediaFileId)
            }
    }

    private companion object {
        /** Any nonzero `Download.stopReason` means "not progressing"; this app only ever sets this one reason (a user-initiated pause). */
        const val STOP_REASON_PAUSED_BY_USER = 1
    }
}

internal data class PersistedDownloadPolicy(
    val epochMillis: Long?,
    val amount: Int?,
    val unit: String?,
)

internal fun KeepUntilSelection.persistedDownloadPolicy(): PersistedDownloadPolicy = when (this) {
    KeepUntilSelection.Forever -> PersistedDownloadPolicy(null, null, null)
    is KeepUntilSelection.SpecificDate -> PersistedDownloadPolicy(epochMillis, null, null)
    is KeepUntilSelection.AfterWatched -> PersistedDownloadPolicy(
        epochMillis = null,
        amount = amount.coerceAtLeast(1),
        unit = if (unit == KeepUntilUnit.Weeks) "weeks" else "days",
    )
}

internal fun DownloadMetadataEntity.keepUntilSelection(): KeepUntilSelection = when {
    keepUntilAmount != null && keepUntilUnit != null -> KeepUntilSelection.AfterWatched(
        amount = keepUntilAmount.coerceAtLeast(1),
        unit = if (keepUntilUnit == "weeks") KeepUntilUnit.Weeks else KeepUntilUnit.Days,
    )
    keepUntilEpochMillis != null -> KeepUntilSelection.SpecificDate(keepUntilEpochMillis)
    else -> KeepUntilSelection.Forever
}

internal fun DownloadMetadataEntity.downloadExpiryEpochMillis(): Long? {
    keepUntilEpochMillis?.let { return it }
    val amount = keepUntilAmount?.coerceAtLeast(1) ?: return null
    val watchedAt = watchedAtEpochMillis ?: return null
    val days = if (keepUntilUnit == "weeks") amount.toLong() * 7L else amount.toLong()
    val durationMillis = runCatching { Math.multiplyExact(days, MILLIS_PER_DAY) }.getOrElse { Long.MAX_VALUE }
    return runCatching { Math.addExact(watchedAt, durationMillis) }.getOrElse { Long.MAX_VALUE }
}

private const val MILLIS_PER_DAY = 24L * 60L * 60L * 1000L

internal fun downloadTicketFileUrl(serverUrl: String, ticketId: String): String =
    "${serverUrl.trimEnd('/')}/api/v1/downloads/${ticketId.downloadPathSegment()}/file"

private fun String.downloadPathSegment(): String =
    URLEncoder.encode(this, StandardCharsets.UTF_8.name()).replace("+", "%20")

private fun Download.failureMessageOrNull(): String? =
    if (failureReason == Download.FAILURE_REASON_NONE) null else "Download failed (reason $failureReason)"

/** `internal` (not `private`) so `DownloadStateMappingTest` can exercise the mapping directly without constructing a real Media3 `Download`. */
internal fun Int.toDownloadState(): DownloadState = when (this) {
    Download.STATE_QUEUED -> DownloadState.Queued
    Download.STATE_STOPPED -> DownloadState.Paused
    Download.STATE_DOWNLOADING -> DownloadState.Downloading
    Download.STATE_COMPLETED -> DownloadState.Completed
    Download.STATE_FAILED -> DownloadState.Failed
    Download.STATE_REMOVING -> DownloadState.Removing
    Download.STATE_RESTARTING -> DownloadState.Queued
    else -> DownloadState.Queued
}
