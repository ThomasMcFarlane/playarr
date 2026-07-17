package io.streamarr.tv

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Intent
import androidx.core.app.NotificationCompat
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import dagger.hilt.android.AndroidEntryPoint
import io.streamarr.shared.data.model.ClientPlatform
import io.streamarr.shared.data.remote.PushRegistrationRequest
import io.streamarr.shared.data.remote.StreamarrApi
import javax.inject.Inject
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

@AndroidEntryPoint
class InviteApprovalMessagingService : FirebaseMessagingService() {
    @Inject lateinit var api: StreamarrApi
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    override fun onRegistered(installationId: String) {
        scope.launch {
            runCatching {
                api.registerPush(PushRegistrationRequest(installationId, ClientPlatform.AndroidTv))
            }
        }
    }

    override fun onMessageReceived(message: RemoteMessage) {
        val channelId = "invite-approvals"
        val manager = getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(
            NotificationChannel(channelId, "Invite approvals", NotificationManager.IMPORTANCE_HIGH),
        )
        val pendingIntent = PendingIntent.getActivity(
            this,
            0,
            Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        manager.notify(
            4101,
            NotificationCompat.Builder(this, channelId)
                .setSmallIcon(R.mipmap.ic_launcher)
                .setContentTitle(message.notification?.title ?: "Friend invite approved")
                .setContentText(
                    message.notification?.body
                        ?: "Open Playarr Settings to generate your 24-hour invite QR.",
                )
                .setContentIntent(pendingIntent)
                .setAutoCancel(true)
                .build(),
        )
    }
}
