package io.streamarr.tv

import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager
import com.google.firebase.FirebaseApp
import com.google.firebase.FirebaseOptions
import com.google.firebase.messaging.FirebaseMessaging
import dagger.hilt.android.HiltAndroidApp
import io.streamarr.shared.auth.TokenStore
import javax.inject.Inject
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.filterNotNull
import kotlinx.coroutines.launch

/** Hilt entry point for the TV app; every `@Inject`/`@AndroidEntryPoint` site roots here. */
@HiltAndroidApp
class StreamarrTvApp : Application() {
    @Inject lateinit var tokenStore: TokenStore
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    override fun onCreate() {
        super.onCreate()
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
