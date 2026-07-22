package io.streamarr.shared.download

/**
 * Where a locally-tracked download is in its lifecycle. Projects Media3's
 * own `androidx.media3.exoplayer.offline.Download.STATE_*` int constants
 * (queued/stopped/downloading/completed/failed/removing/restarting) into a
 * small enum so UI code doesn't need Media3 on its classpath just to read a
 * download's status -- see `Download.toDownloadState()` in
 * `DefaultDownloadRepository.kt` for the mapping.
 */
enum class DownloadState { Queued, Downloading, Paused, Completed, Failed, Removing }

/**
 * One entry in the Downloads screen / [DownloadRepository.observeDownloads].
 * Merges Room's own display metadata + Keep-until policy (title/poster/
 * Keep-until -- what Media3's `DownloadIndex` doesn't track) with Media3's
 * live byte progress/state for the same `mediaFileId`, re-emitted whenever
 * either side changes. See `DefaultDownloadRepository.observeDownloads`.
 */
data class DownloadEntity(
    val mediaFileId: String,
    val workId: String,
    val title: String,
    val workTitle: String,
    val posterUrl: String?,
    /** `"movie" | "episode" | "track" | "book"`. */
    val kind: String,
    val qualityId: String,
    val qualityLabel: String = qualityId,
    /** The server `DownloadTicket` id this download's bytes were fetched from, if any resolved yet. */
    val ticketId: String?,
    /** Owning server origin, retained so artwork, retries, and offline progress keep the right auth boundary. */
    val serverUrl: String,
    val state: DownloadState,
    val bytesDownloaded: Long,
    /** `null` when Media3 hasn't resolved the content length yet. */
    val totalBytes: Long?,
    /** `null` means "keep forever". */
    val keepUntilEpochMillis: Long?,
    /** Retains the unresolved Web-compatible policy so "after watched" begins at the actual watch event. */
    val keepUntilSelection: KeepUntilSelection = keepUntilEpochMillis
        ?.let(KeepUntilSelection::SpecificDate)
        ?: KeepUntilSelection.Forever,
    val failureMessage: String?,
    val addedAtEpochMillis: Long,
)

/**
 * One playable leaf to enqueue a download for: a movie/episode/track/book's
 * own `mediaFileId` plus the display metadata [DownloadRepository.enqueue]
 * persists into Room. Built by the UI from a `WorkDetail`'s child tree; a
 * season/album "download all" action fans this out to every child leaf that
 * has a resolved `mediaFileId` (unavailable leaves are simply omitted).
 */
data class DownloadCandidate(
    val mediaFileId: String,
    val workId: String,
    val title: String,
    val workTitle: String,
    val posterUrl: String?,
    val kind: String,
)
