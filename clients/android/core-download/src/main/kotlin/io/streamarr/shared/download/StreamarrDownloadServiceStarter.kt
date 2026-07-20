package io.streamarr.shared.download

import androidx.media3.exoplayer.offline.DownloadRequest

/**
 * The one thing [DefaultDownloadRepository] needs from the app module that
 * `core-download` can't reference directly without inverting the module
 * dependency graph: routing a download command through the real
 * `StreamarrDownloadService` (Media3's own `DownloadService`, which owns
 * the foreground-service/notification lifecycle -- see that class's KDoc in
 * the `:app` module). Every method here is a thin wrapper the app module's
 * `DefaultStreamarrDownloadServiceStarter` implements by delegating to
 * Media3's own `DownloadService.sendXxx(...)` static helpers against the
 * concrete `StreamarrDownloadService::class.java`, which both starts the
 * service (if not already running) and forwards the command into the
 * shared `DownloadManager` singleton it hosts.
 *
 * Reads (the current download list/progress/state) don't need this
 * indirection -- [DefaultDownloadRepository] reads Media3's `DownloadManager`
 * directly (a `@Singleton` the app module's `DownloadModule` provides, and
 * which carries no app-module type dependency itself).
 */
interface StreamarrDownloadServiceStarter {
    fun addDownload(request: DownloadRequest)
    fun removeDownload(mediaFileId: String)

    /** `Download.STOP_REASON_NONE` (0) resumes; any other app-defined nonzero value pauses. */
    fun setStopReason(mediaFileId: String, stopReason: Int)
}
