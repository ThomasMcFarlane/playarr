package io.streamarr.mobile

import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager
import androidx.hilt.work.HiltWorkerFactory
import androidx.work.Configuration
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.PeriodicWorkRequest
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import com.google.firebase.FirebaseApp
import com.google.firebase.FirebaseOptions
import com.google.firebase.messaging.FirebaseMessaging
import dagger.hilt.android.HiltAndroidApp
import io.streamarr.mobile.download.KeepUntilSweepWorker
import io.streamarr.shared.auth.TokenStore
import java.util.concurrent.TimeUnit
import javax.inject.Inject
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.filterNotNull
import kotlinx.coroutines.launch

/** Hilt entry point for the mobile app; every `@Inject`/`@AndroidEntryPoint` site roots here. */
@HiltAndroidApp
class StreamarrMobileApp : Application(), Configuration.Provider {
    @Inject lateinit var tokenStore: TokenStore

    /**
     * Lets `KeepUntilSweepWorker` (a `@HiltWorker`) get its dependencies
     * Hilt-injected rather than WorkManager's default reflection-based
     * no-arg construction. Requires disabling WorkManager's own default
     * `androidx.startup` initializer in `AndroidManifest.xml` (see that
     * file) -- otherwise the default, non-Hilt-aware `WorkManager` instance
     * initializes first and this [workManagerConfiguration] is never used.
     */
    @Inject lateinit var hiltWorkerFactory: HiltWorkerFactory

    override val workManagerConfiguration: Configuration
        get() = Configuration.Builder().setWorkerFactory(hiltWorkerFactory).build()

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    override fun onCreate() {
        super.onCreate()
        // Downloads' own notification channel is created lazily by
        // StreamarrDownloadService's DownloadService constructor (which is
        // given the channel name/description string resources directly),
        // not here.
        WorkManager.getInstance(this).enqueueUniquePeriodicWork(
            KEEP_UNTIL_SWEEP_WORK_NAME,
            // KEEP: a periodic sweep already scheduled from a prior launch
            // should keep its existing schedule/next-run-time rather than
            // being reset every cold start.
            ExistingPeriodicWorkPolicy.KEEP,
            PeriodicWorkRequestBuilder<KeepUntilSweepWorker>(
                PeriodicWorkRequest.MIN_PERIODIC_INTERVAL_MILLIS,
                TimeUnit.MILLISECONDS,
            ).build(),
        )
        if (!initialiseFirebase()) return
        getSystemService(NotificationManager::class.java).createNotificationChannel(
            NotificationChannel("invite-approvals", "Invite approvals", NotificationManager.IMPORTANCE_HIGH),
        )
        FirebaseMessaging.getInstance().isAutoInitEnabled = true
        scope.launch {
            tokenStore.accessToken.filterNotNull().collect {
                FirebaseMessaging.getInstance().register()
            }
        }
    }

    private companion object {
        const val KEEP_UNTIL_SWEEP_WORK_NAME = "streamarr-keep-until-sweep"
    }

    private fun initialiseFirebase(): Boolean {
        if (BuildConfig.FIREBASE_API_KEY.isBlank() || BuildConfig.FIREBASE_APPLICATION_ID.isBlank() ||
            BuildConfig.FIREBASE_PROJECT_ID.isBlank() || BuildConfig.FIREBASE_SENDER_ID.isBlank()
        ) return false
        if (FirebaseApp.getApps(this).isEmpty()) {
            FirebaseApp.initializeApp(
                this,
                FirebaseOptions.Builder()
                    .setApiKey(BuildConfig.FIREBASE_API_KEY)
                    .setApplicationId(BuildConfig.FIREBASE_APPLICATION_ID)
                    .setProjectId(BuildConfig.FIREBASE_PROJECT_ID)
                    .setGcmSenderId(BuildConfig.FIREBASE_SENDER_ID)
                    .build(),
            )
        }
        return true
    }
}
