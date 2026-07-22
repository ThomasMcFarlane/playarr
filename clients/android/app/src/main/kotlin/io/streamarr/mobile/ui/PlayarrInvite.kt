package io.streamarr.mobile.ui

import android.Manifest
import android.content.ClipData
import android.content.ClipboardManager
import android.content.pm.PackageManager
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import com.google.firebase.messaging.FirebaseMessaging
import io.streamarr.mobile.BuildConfig
import io.streamarr.shared.data.model.PeerAddressEntry
import java.net.URLEncoder
import java.nio.charset.StandardCharsets
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Base64
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json

private const val PlayarrSignupUrl = "https://playarr.app/signup"

internal data class PlayarrGeneratedInvite(
    val link: String,
    val expiresAt: String,
)

internal fun buildPlayarrInviteUrl(
    addresses: List<PeerAddressEntry>,
    inviteToken: String,
): String {
    val json = Json.encodeToString(ListSerializer(PeerAddressEntry.serializer()), addresses)
    val servers = Base64.getUrlEncoder().withoutPadding().encodeToString(json.toByteArray(StandardCharsets.UTF_8))
    val token = URLEncoder.encode(inviteToken, StandardCharsets.UTF_8.toString())
    return "$PlayarrSignupUrl?servers=$servers&invite=$token"
}

internal fun playarrInviteAddresses(
    addresses: List<PeerAddressEntry>,
    fallbackServerUrl: String,
): List<PeerAddressEntry> = addresses.ifEmpty {
    listOf(PeerAddressEntry(peerNodeId = "", url = fallbackServerUrl))
}

@Composable
internal fun PlayarrInviteDialog(
    invite: PlayarrGeneratedInvite,
    onDismiss: () -> Unit,
) {
    val context = LocalContext.current
    var copied by remember(invite.link) { mutableStateOf(false) }
    val expiry = remember(invite.expiresAt) {
        runCatching {
            DateTimeFormatter.ofLocalizedDateTime(FormatStyle.MEDIUM)
                .withZone(ZoneId.systemDefault())
                .format(Instant.parse(invite.expiresAt))
        }.getOrNull()
    }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Friend invitation") },
        text = {
            Column(
                Modifier.fillMaxWidth().heightIn(max = 620.dp).verticalScroll(rememberScrollState()),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(14.dp),
            ) {
                Text("Scan this QR code or copy the one-use link. It can create one Playarr profile.", color = WebInkMuted, fontSize = 12.sp)
                PlayarrQrCode(
                    value = invite.link,
                    contentDescription = "QR code for the friend invitation",
                    modifier = Modifier.size(260.dp),
                )
                OutlinedTextField(
                    value = invite.link,
                    onValueChange = {},
                    readOnly = true,
                    label = { Text("Invitation link") },
                    modifier = Modifier.fillMaxWidth(),
                )
                expiry?.let { Text("Expires $it", color = WebInkMuted, fontSize = 11.sp) }
            }
        },
        confirmButton = {
            Button(
                onClick = {
                    context.getSystemService(ClipboardManager::class.java)
                        .setPrimaryClip(ClipData.newPlainText("Playarr invitation", invite.link))
                    copied = true
                },
            ) { Text(if (copied) "Copied" else "Copy link") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Close") } },
    )
}

@Composable
internal fun PlayarrApprovalNotifications() {
    val context = LocalContext.current
    val firebaseConfigured = BuildConfig.FIREBASE_APPLICATION_ID.isNotBlank()
    var enabled by remember {
        mutableStateOf(
            Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
                ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED,
        )
    }
    var error by remember { mutableStateOf<String?>(null) }
    val permission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        enabled = granted
        error = if (granted) {
            runCatching { FirebaseMessaging.getInstance().register() }.exceptionOrNull()?.message
        } else {
            "Notification permission was not granted."
        }
    }
    if (!firebaseConfigured) {
        Text("Approval notifications are not configured in this build.", color = WebInkMuted, fontSize = 11.sp)
        return
    }
    Button(
        onClick = {
            error = null
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                permission.launch(Manifest.permission.POST_NOTIFICATIONS)
            } else {
                runCatching { FirebaseMessaging.getInstance().register() }
                    .onSuccess { enabled = true }
                    .onFailure { error = it.message ?: "Approval notifications could not be enabled." }
            }
        },
        enabled = !enabled,
    ) { Text(if (enabled) "Approval notifications enabled" else "Enable approval notifications") }
    error?.let { Text(it, color = androidx.compose.material3.MaterialTheme.colorScheme.error, fontSize = 11.sp) }
}
