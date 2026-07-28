package io.playarr.mobile.download

import android.content.Context
import androidx.hilt.work.HiltWorker
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import dagger.assisted.Assisted
import dagger.assisted.AssistedInject
import io.playarr.shared.download.DownloadRepository
import io.playarr.shared.download.OfflineProgressRepository

/**
 * Periodic (WorkManager's 15-minute floor) sweep for two things that only
 * matter if they happen even while the app isn't open:
 *
 * - [DownloadRepository.sweepExpired] -- removes any download whose
 *   Keep-until has passed.
 * - [OfflineProgressRepository.flushPending] -- opportunistically retries
 *   replaying watch-progress updates buffered while this device was
 *   offline; this worker already runs periodically with the device likely
 *   back online by the time it fires.
 *
 * Lives in `:app` (not `core-download`, unlike everything else this touches)
 * as a deliberate simplification: `@HiltWorker`'s codegen needs
 * `androidx.hilt:hilt-compiler` KSP processing wherever the annotated class
 * lives, and `:app` already carries that (for `NetworkModule`/
 * `RepositoryModule`/... 's own Hilt codegen) -- giving `core-download` the
 * same Hilt/KSP setup for just this one class wasn't worth a second
 * module carrying that machinery.
 *
 * Enqueued once, uniquely, from [io.playarr.mobile.PlayarrMobileApp]'s
 * `onCreate` via `enqueueUniquePeriodicWork(..., ExistingPeriodicWorkPolicy.KEEP, ...)`.
 */
@HiltWorker
class KeepUntilSweepWorker @AssistedInject constructor(
    @Assisted appContext: Context,
    @Assisted workerParams: WorkerParameters,
    private val downloadRepository: DownloadRepository,
    private val offlineProgressRepository: OfflineProgressRepository,
) : CoroutineWorker(appContext, workerParams) {

    override suspend fun doWork(): Result = try {
        downloadRepository.sweepExpired()
        offlineProgressRepository.flushPending()
        Result.success()
    } catch (error: Exception) {
        Result.retry()
    }
}
