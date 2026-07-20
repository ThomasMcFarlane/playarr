package io.streamarr.mobile.download

import android.app.Notification
import androidx.media3.exoplayer.offline.Download
import androidx.media3.exoplayer.offline.DownloadManager
import androidx.media3.exoplayer.offline.DownloadNotificationHelper
import androidx.media3.exoplayer.offline.DownloadService
import androidx.media3.exoplayer.scheduler.Scheduler
import dagger.hilt.android.AndroidEntryPoint
import io.streamarr.mobile.R
import javax.inject.Inject

/**
 * The real, live Media3 `DownloadService` -- lives in `:app` (not
 * `core-download`) because a `DownloadService` is a manifest-registered
 * Android component with app-owned notification/icon resources
 * (`R.string`/`R.drawable`), not because of any Hilt limitation. It hosts
 * exactly the same [DownloadManager] singleton [io.streamarr.mobile.di.DownloadModule]
 * provides everywhere else in the app -- Media3 requires the service and
 * any direct `DownloadManager` reads (see `core-download`'s
 * `DefaultDownloadRepository`) to share one instance.
 *
 * Declared as a foreground service in `AndroidManifest.xml` with
 * `foregroundServiceType="dataSync"`; [DownloadService] itself promotes to
 * the foreground while any download is active and demotes when idle.
 */
@AndroidEntryPoint
class StreamarrDownloadService : DownloadService(
    NOTIFICATION_ID,
    FOREGROUND_NOTIFICATION_UPDATE_INTERVAL_MS,
    DOWNLOAD_NOTIFICATION_CHANNEL_ID,
    R.string.download_channel_name,
    R.string.download_channel_description,
) {

    @Inject lateinit var downloadManagerSingleton: DownloadManager

    private val notificationHelper by lazy(LazyThreadSafetyMode.NONE) {
        DownloadNotificationHelper(this, DOWNLOAD_NOTIFICATION_CHANNEL_ID)
    }

    override fun getDownloadManager(): DownloadManager = downloadManagerSingleton

    /**
     * No [Scheduler]: auto-resuming downloads after a device reboot or a
     * requirements change while this app isn't running needs
     * `android.permission.RECEIVE_BOOT_COMPLETED` plus Media3's
     * `PlatformScheduler`, deliberately left out of this pass -- a
     * paused/interrupted download simply resumes the next time this
     * service is started (the app reopening, or another download being
     * queued), which is an acceptable simplification for a first pass at
     * this feature.
     */
    override fun getScheduler(): Scheduler? = null

    override fun getForegroundNotification(downloads: MutableList<Download>, notMetRequirements: Int): Notification =
        notificationHelper.buildProgressNotification(
            /* context = */ this,
            /* smallIcon = */ R.drawable.playarr_mark,
            /* contentIntent = */ null,
            /* message = */ getString(R.string.download_notification_title),
            downloads,
            notMetRequirements,
        )

    private companion object {
        const val NOTIFICATION_ID = 4200
        const val DOWNLOAD_NOTIFICATION_CHANNEL_ID = "streamarr_downloads"

        /** Media3's own documented default foreground-notification refresh cadence. */
        const val FOREGROUND_NOTIFICATION_UPDATE_INTERVAL_MS = 1000L
    }
}
