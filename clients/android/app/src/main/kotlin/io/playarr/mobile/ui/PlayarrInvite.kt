package io.playarr.mobile.ui

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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import com.google.firebase.messaging.FirebaseMessaging
import io.playarr.mobile.BuildConfig
import io.playarr.shared.data.model.InviteRequestStatus
import io.playarr.shared.data.model.PeerAddressEntry
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

internal fun InviteRequestStatus?.playarrInviteStatusKey(): PlayarrString = when (this) {
    null -> PlayarrString.SettingsInviteStatusNone
    InviteRequestStatus.Pending -> PlayarrString.SettingsInviteStatusPending
    InviteRequestStatus.Approved -> PlayarrString.SettingsInviteStatusApproved
    InviteRequestStatus.Denied -> PlayarrString.SettingsInviteStatusDenied
    InviteRequestStatus.Generated -> PlayarrString.SettingsInviteStatusGenerated
}

@Composable
internal fun PlayarrInviteDialog(
    invite: PlayarrGeneratedInvite,
    onDismiss: () -> Unit,
) {
    val context = LocalContext.current
    val language = LocalPlayarrLanguage.current
    val clipboardLabel = playarrString(PlayarrString.SettingsInviteModalTitle)
    var copied by remember(invite.link) { mutableStateOf(false) }
    val expiry = remember(invite.expiresAt, language.locale) {
        runCatching {
            DateTimeFormatter.ofLocalizedDateTime(FormatStyle.MEDIUM)
                .withLocale(language.locale)
                .withZone(ZoneId.systemDefault())
                .format(Instant.parse(invite.expiresAt))
        }.getOrNull()
    }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(playarrString(PlayarrString.SettingsInviteModalTitle)) },
        text = {
            Column(
                Modifier.fillMaxWidth().heightIn(max = 620.dp).verticalScroll(rememberScrollState()),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(14.dp),
            ) {
                Text(
                    playarrString(PlayarrString.SettingsInviteModalKicker),
                    color = WebPink,
                    fontSize = 10.sp,
                    fontWeight = FontWeight.ExtraBold,
                )
                Text(
                    playarrString(PlayarrString.SettingsInviteModalDescription),
                    color = WebInkMuted,
                    fontSize = 12.sp,
                )
                PlayarrQrCode(
                    value = invite.link,
                    contentDescription = playarrString(PlayarrString.SettingsInviteQrLabel),
                    modifier = Modifier.size(260.dp),
                )
                OutlinedTextField(
                    value = invite.link,
                    onValueChange = {},
                    readOnly = true,
                    label = { Text(playarrString(PlayarrString.SettingsInviteLinkLabel)) },
                    modifier = Modifier.fillMaxWidth(),
                )
                expiry?.let {
                    Text(
                        playarrString(PlayarrString.SettingsInviteExpires, "expiresAt" to it),
                        color = WebInkMuted,
                        fontSize = 11.sp,
                    )
                }
            }
        },
        confirmButton = {
            Button(
                onClick = {
                    context.getSystemService(ClipboardManager::class.java)
                        .setPrimaryClip(ClipData.newPlainText(clipboardLabel, invite.link))
                    copied = true
                },
            ) {
                Text(
                    playarrString(
                        if (copied) PlayarrString.SettingsInviteCopied else PlayarrString.SettingsInviteCopyLink,
                    ),
                )
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) { Text(playarrString(PlayarrString.CommonClose)) }
        },
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
    var enabling by remember { mutableStateOf(false) }
    val permissionDenied = playarrString(PlayarrString.SettingsInvitePushPermissionDenied)
    val enableFailed = playarrString(PlayarrString.SettingsInvitePushFailed)
    val permission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) {
            val failure = runCatching { FirebaseMessaging.getInstance().register() }.exceptionOrNull()
            enabled = failure == null
            error = failure?.message ?: if (enabled) null else enableFailed
        } else {
            enabled = false
            error = permissionDenied
        }
        enabling = false
    }
    if (!firebaseConfigured) {
        Text(
            playarrString(PlayarrString.SettingsInvitePushUnavailable),
            color = WebInkMuted,
            fontSize = 11.sp,
        )
        return
    }
    Button(
        onClick = {
            error = null
            enabling = true
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                permission.launch(Manifest.permission.POST_NOTIFICATIONS)
            } else {
                runCatching { FirebaseMessaging.getInstance().register() }
                    .onSuccess { enabled = true }
                    .onFailure { error = it.message ?: enableFailed }
                enabling = false
            }
        },
        enabled = !enabled && !enabling,
    ) {
        Text(
            playarrString(
                when {
                    enabled -> PlayarrString.SettingsInvitePushEnabled
                    enabling -> PlayarrString.SettingsInvitePushEnabling
                    else -> PlayarrString.SettingsInviteEnablePush
                },
            ),
        )
    }
    error?.let { Text(it, color = androidx.compose.material3.MaterialTheme.colorScheme.error, fontSize = 11.sp) }
}
