package io.streamarr.mobile.download

import android.content.Context
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.offline.DownloadRequest
import androidx.media3.exoplayer.offline.DownloadService
import dagger.hilt.android.qualifiers.ApplicationContext
import io.streamarr.shared.download.StreamarrDownloadServiceStarter
import javax.inject.Inject

/**
 * Real implementation of `core-download`'s [StreamarrDownloadServiceStarter],
 * routing every command through Media3's own `DownloadService.sendXxx(...)`
 * static helpers against the concrete [StreamarrDownloadService] -- this is
 * the one place in the app that needs to name that class directly, which is
 * exactly why the interface exists on the `core-download` side (see its
 * KDoc).
 */
@UnstableApi
class DefaultStreamarrDownloadServiceStarter @Inject constructor(
    @param:ApplicationContext private val context: Context,
) : StreamarrDownloadServiceStarter {

    override fun addDownload(request: DownloadRequest) {
        DownloadService.sendAddDownload(context, StreamarrDownloadService::class.java, request, false)
    }

    override fun removeDownload(mediaFileId: String) {
        DownloadService.sendRemoveDownload(context, StreamarrDownloadService::class.java, mediaFileId, false)
    }

    override fun setStopReason(mediaFileId: String, stopReason: Int) {
        DownloadService.sendSetStopReason(context, StreamarrDownloadService::class.java, mediaFileId, stopReason, false)
    }
}
