package io.playarr.mobile.download

import android.content.Context
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.offline.DownloadRequest
import androidx.media3.exoplayer.offline.DownloadService
import dagger.hilt.android.qualifiers.ApplicationContext
import io.playarr.shared.download.PlayarrDownloadServiceStarter
import javax.inject.Inject

/**
 * Real implementation of `core-download`'s [PlayarrDownloadServiceStarter],
 * routing every command through Media3's own `DownloadService.sendXxx(...)`
 * static helpers against the concrete [PlayarrDownloadService] -- this is
 * the one place in the app that needs to name that class directly, which is
 * exactly why the interface exists on the `core-download` side (see its
 * KDoc).
 */
@UnstableApi
class DefaultPlayarrDownloadServiceStarter @Inject constructor(
    @param:ApplicationContext private val context: Context,
) : PlayarrDownloadServiceStarter {

    override fun addDownload(request: DownloadRequest) {
        DownloadService.sendAddDownload(context, PlayarrDownloadService::class.java, request, false)
    }

    override fun removeDownload(mediaFileId: String) {
        DownloadService.sendRemoveDownload(context, PlayarrDownloadService::class.java, mediaFileId, false)
    }

    override fun setStopReason(mediaFileId: String, stopReason: Int) {
        DownloadService.sendSetStopReason(context, PlayarrDownloadService::class.java, mediaFileId, stopReason, false)
    }
}
