package io.playarr.mobile.ui

import io.playarr.shared.designsystem.component.PlayarrButton
import io.playarr.shared.designsystem.component.PlayarrButtonVariant
import android.app.Activity
import android.net.Uri
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.navigation.NavHostController
import dagger.hilt.android.lifecycle.HiltViewModel
import io.playarr.mobile.remote.HandoffFailure
import io.playarr.mobile.remote.HandoffProgress
import io.playarr.mobile.remote.RemoteController
import io.playarr.mobile.remote.RemoteHandoffApi
import io.playarr.mobile.remote.RemotePairingRequest
import io.playarr.mobile.remote.RemotePlayerControls
import io.playarr.mobile.remote.handoffDestinationStarted
import io.playarr.mobile.remote.RemoteUiBridge
import io.playarr.mobile.remote.apiErrorCode
import io.playarr.mobile.remote.handOffPlayback
import io.playarr.shared.data.model.CreateRemoteHandoffRequest
import io.playarr.shared.data.model.CreateRemotePairingRequest
import io.playarr.shared.data.model.RemoteCapability
import io.playarr.shared.data.model.RemoteCommandRequest
import io.playarr.shared.data.model.RemoteHandoff
import io.playarr.shared.data.model.RemotePairing
import io.playarr.shared.data.model.RemotePlaybackSnapshot
import io.playarr.shared.data.model.RemoteTarget
import io.playarr.shared.data.model.RenameRemotePairingRequest
import io.playarr.shared.data.remote.PlayarrRemoteApi
import java.util.UUID
import javax.inject.Inject
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/** Controller side of the phone remote and the source side of "Play on another device". */
@HiltViewModel
internal class RemoteViewModel @Inject constructor(
    private val api: PlayarrRemoteApi,
    val controller: RemoteController,
) : ViewModel() {
    private val _targets = MutableStateFlow<List<RemoteTarget>>(emptyList())
    val targets: StateFlow<List<RemoteTarget>> = _targets.asStateFlow()
    private val _pairings = MutableStateFlow<List<RemotePairing>>(emptyList())
    val pairings: StateFlow<List<RemotePairing>> = _pairings.asStateFlow()
    private val _pending = MutableStateFlow<RemotePairing?>(null)
    val pending: StateFlow<RemotePairing?> = _pending.asStateFlow()
    private val _controlling = MutableStateFlow<String?>(null)
    val controlling: StateFlow<String?> = _controlling.asStateFlow()
    private val _error = MutableStateFlow<PlayarrString?>(null)
    val error: StateFlow<PlayarrString?> = _error.asStateFlow()

    suspend fun refresh() {
        try {
            _targets.value = api.listTargets()
            _pairings.value = api.listPairings()
        } catch (cancel: kotlinx.coroutines.CancellationException) {
            throw cancel
        } catch (_: Exception) {
            _error.value = PlayarrString.RemoteLoadFailed
        }
    }

    fun activePairingFor(deviceId: String): RemotePairing? =
        _pairings.value.firstOrNull { it.targetDeviceId == deviceId && it.status == "active" && it.isController }

    fun pair(target: RemoteTarget, controllerName: String) {
        viewModelScope.launch {
            _error.value = null
            try {
                val pairing = api.createPairing(
                    CreateRemotePairingRequest(targetDeviceId = target.deviceId, controllerName = controllerName),
                )
                if (pairing.status == "active") {
                    _controlling.value = target.deviceId
                } else {
                    _pending.value = pairing
                    awaitApproval(pairing, target.deviceId)
                }
            } catch (cancel: kotlinx.coroutines.CancellationException) {
                throw cancel
            } catch (error: Exception) {
                if (error.apiErrorCode() == "already_paired") {
                    refresh()
                    _controlling.value = target.deviceId
                } else {
                    _error.value = PlayarrString.RemotePairFailed
                }
            }
            refresh()
        }
    }

    /**
     * Waits for the target to approve [pairing]. Transient network errors keep
     * waiting, but the wait always ends (denied, expired or timed out) and
     * always clears [pending], so the Pair buttons never stay disabled.
     */
    private suspend fun awaitApproval(pairing: RemotePairing, deviceId: String) {
        var current = pairing
        try {
            while (current.status == "pending" && System.currentTimeMillis() < current.expiresMs) {
                delay(2_000L)
                current = try {
                    api.getPairing(current.id)
                } catch (cancel: kotlinx.coroutines.CancellationException) {
                    throw cancel
                } catch (_: Exception) {
                    current
                }
            }
        } finally {
            _pending.value = null
        }
        if (current.status == "active") _controlling.value = deviceId
        else _error.value = PlayarrString.RemotePairingNotApproved
    }

    fun control(deviceId: String) {
        _controlling.value = deviceId
    }

    fun revoke(pairing: RemotePairing) {
        viewModelScope.launch {
            try {
                api.revokePairing(pairing.id)
                if (_controlling.value == pairing.targetDeviceId) _controlling.value = null
            } catch (cancel: kotlinx.coroutines.CancellationException) {
                throw cancel
            } catch (_: Exception) {
                _error.value = PlayarrString.RemoteRevokeFailed
            }
            refresh()
        }
    }

    fun rename(pairing: RemotePairing, name: String) {
        val clean = name.trim()
        if (clean.isEmpty()) return
        viewModelScope.launch {
            try {
                api.renamePairing(pairing.id, RenameRemotePairingRequest(clean))
            } catch (cancel: kotlinx.coroutines.CancellationException) {
                throw cancel
            } catch (_: Exception) {
                _error.value = PlayarrString.RemoteRenameFailed
            }
            refresh()
        }
    }

    /** Sends one command and surfaces a failed execution on the target. */
    fun send(pairing: RemotePairing, kind: String, payload: JsonObject) {
        viewModelScope.launch {
            _error.value = null
            try {
                val accepted = api.sendCommand(pairing.id, RemoteCommandRequest(kind, payload))
                repeat(6) {
                    delay(250L)
                    val status = api.commandStatus(accepted.commandId).status
                    if (status == "ok") return@launch
                    if (status in setOf("failed", "unsupported", "revoked", "expired")) {
                        _error.value = PlayarrString.RemoteFailed
                        return@launch
                    }
                }
            } catch (cancel: kotlinx.coroutines.CancellationException) {
                throw cancel
            } catch (error: Exception) {
                _error.value = if (error.apiErrorCode() == "target_offline") PlayarrString.RemoteDeviceOffline else PlayarrString.RemoteFailed
            }
        }
    }

    private val _moving = MutableStateFlow(false)
    val moving: StateFlow<Boolean> = _moving.asStateFlow()

    private fun handoffApi() = object : RemoteHandoffApi {
        override suspend fun createHandoff(request: CreateRemoteHandoffRequest) = api.createHandoff(request)
        override suspend fun getHandoff(id: String, waitSeconds: Int) = api.getHandoff(id, waitSeconds)
        override suspend fun createPairing(request: CreateRemotePairingRequest) = api.createPairing(request)
        override suspend fun getPairing(id: String) = api.getPairing(id)
    }

    /**
     * Controller-initiated handoff: moves what [source] is playing to [destination]. The server
     * snapshots the source's last reported state and stops it only after the destination
     * confirms playback; on any failure the source keeps playing.
     */
    fun movePlayback(source: RemoteTarget, destination: RemoteTarget) {
        if (_moving.value) return
        viewModelScope.launch {
            _error.value = null
            _moving.value = true
            try {
                handOffPlayback(
                    api = handoffApi(),
                    sourceDeviceId = source.deviceId,
                    destinationDeviceId = destination.deviceId,
                    mediaFileId = null,
                    snapshot = null,
                    controllerName = controller.deviceName(),
                    requestKey = UUID.randomUUID().toString(),
                )
            } catch (cancel: kotlinx.coroutines.CancellationException) {
                throw cancel
            } catch (_: Exception) {
                _error.value = PlayarrString.RemoteMoveFailed
            } finally {
                _moving.value = false
            }
            refresh()
        }
    }

    suspend fun listCandidates(): Pair<String?, List<RemoteTarget>> {
        repeat(5) { attempt ->
            val list = runCatching { api.listTargets() }.getOrNull()
            val me = list?.firstOrNull { it.isSelf }
            if (list != null && (me != null || attempt == 4)) return me?.deviceId to list
            delay(800L)
        }
        return null to emptyList()
    }

    suspend fun handOff(
        sourceDeviceId: String,
        target: RemoteTarget,
        player: RemotePlayerControls,
        onProgress: (HandoffProgress) -> Unit,
    ): RemoteHandoff = handOffPlayback(
        api = handoffApi(),
        sourceDeviceId = sourceDeviceId,
        destinationDeviceId = target.deviceId,
        mediaFileId = player.mediaFileId,
        snapshot = RemotePlaybackSnapshot(
            positionMs = player.positionMs(),
            durationMs = player.durationMs().takeIf { it > 0L },
            paused = player.isPaused(),
        ),
        controllerName = controller.deviceName(),
        requestKey = UUID.randomUUID().toString(),
        onProgress = onProgress,
    )
}

/** Settings > Phone remote: opt-in hosting, pairing, the on-screen remote and revocation. */
@Composable
internal fun ColumnScope.RemoteSettingsPanel(viewModel: RemoteViewModel = hiltViewModel()) {
    val targets by viewModel.targets.collectAsState()
    val pairings by viewModel.pairings.collectAsState()
    val pending by viewModel.pending.collectAsState()
    val controlling by viewModel.controlling.collectAsState()
    val error by viewModel.error.collectAsState()
    val hostEnabled by viewModel.controller.hostEnabled.collectAsState()
    LaunchedEffect(Unit) {
        while (true) {
            viewModel.refresh()
            delay(5_000L)
        }
    }
    fun nameOf(deviceId: String) =
        targets.firstOrNull { it.deviceId == deviceId }?.name
    val unknown = playarrString(PlayarrString.RemoteUnknownDevice)

    // The controller comes first so it is on screen without scrolling past the device lists.
    val moving by viewModel.moving.collectAsState()
    val controlPairing = controlling?.let(viewModel::activePairingFor)
    if (controlPairing != null) {
        RemotePad(
            pairing = controlPairing,
            targetName = nameOf(controlPairing.targetDeviceId) ?: unknown,
            onSend = { kind, payload -> viewModel.send(controlPairing, kind, payload) },
        )
        val source = targets.firstOrNull { it.deviceId == controlPairing.targetDeviceId }
        val playing = source?.state?.let { (it as? JsonObject)?.get("media_file_id") } != null
        if (source != null && playing && RemoteCapability.Handoff in controlPairing.scopes) {
            Text(playarrString(PlayarrString.RemoteMoveTitle, "name" to source.name), color = WebInk, fontWeight = FontWeight.SemiBold)
            val me = targets.firstOrNull { it.isSelf }
            if (me == null) {
                Text(playarrString(PlayarrString.RemoteMoveNeedsHost), color = WebInkMuted, fontSize = 12.sp)
            } else {
                PlayarrButton(onClick = { viewModel.movePlayback(source, me) }, enabled = !moving, modifier = Modifier.fillMaxWidth()) {
                    Text(playarrString(PlayarrString.RemoteMoveHere))
                }
            }
            targets.filter { !it.isSelf && it.deviceId != source.deviceId && it.online && RemoteCapability.Handoff in it.capabilities }
                .forEach { other ->
                    PlayarrButton(onClick = { viewModel.movePlayback(source, other) }, enabled = !moving, modifier = Modifier.fillMaxWidth(), variant = PlayarrButtonVariant.Secondary) {
                        Text(playarrString(PlayarrString.RemoteMoveTo, "name" to other.name))
                    }
                }
            if (moving) Text(playarrString(PlayarrString.RemoteMoving), color = WebPink)
        }
    }

    Text(playarrString(PlayarrString.RemoteHostTitle), color = WebInk, fontWeight = FontWeight.SemiBold)
    Row(horizontalArrangement = Arrangement.spacedBy(12.dp), modifier = Modifier.fillMaxWidth()) {
        Switch(checked = hostEnabled, onCheckedChange = viewModel.controller::setHostEnabled)
        Text(playarrString(PlayarrString.RemoteHostToggle), color = WebInk)
    }
    Text(playarrString(PlayarrString.RemoteHostHint), color = WebInkMuted, fontSize = 11.sp)

    Text(playarrString(PlayarrString.RemoteTargetsTitle), color = WebInk, fontWeight = FontWeight.SemiBold)
    val others = targets.filterNot { it.isSelf }
    if (others.isEmpty()) Text(playarrString(PlayarrString.RemoteTargetsEmpty), color = WebInkMuted)
    val controllerName = viewModel.controller.deviceName()
    others.forEach { target ->
        val existing = viewModel.activePairingFor(target.deviceId)
        PlayarrButton(
            onClick = { if (existing != null) viewModel.control(target.deviceId) else viewModel.pair(target, controllerName) },
            enabled = target.online && pending == null,
            modifier = Modifier.fillMaxWidth(),
            variant = PlayarrButtonVariant.Secondary,
        ) {
            Text(
                "${target.name}  ·  " + when {
                    !target.online -> playarrString(PlayarrString.RemoteOffline)
                    existing != null -> playarrString(PlayarrString.RemoteControl)
                    else -> playarrString(PlayarrString.RemotePair)
                },
            )
        }
    }
    pending?.let {
        Text(
            playarrString(
                PlayarrString.RemotePairingWaiting,
                "name" to (nameOf(it.targetDeviceId) ?: unknown),
                "code" to it.verificationCode.orEmpty(),
            ),
            color = WebPink,
        )
    }
    error?.let { Text(playarrString(it), color = MaterialTheme.colorScheme.error) }

    Text(playarrString(PlayarrString.RemotePairingsTitle), color = WebInk, fontWeight = FontWeight.SemiBold)
    val live = pairings.filter { it.status == "active" || it.status == "pending" }
    if (live.isEmpty()) Text(playarrString(PlayarrString.RemotePairingsEmpty), color = WebInkMuted)
    var renaming by remember { mutableStateOf<Pair<String, String>?>(null) }
    live.forEach { pairing ->
        val editing = renaming?.takeIf { it.first == pairing.id }
        if (editing != null) {
            Column(verticalArrangement = Arrangement.spacedBy(6.dp), modifier = Modifier.fillMaxWidth()) {
                OutlinedTextField(
                    value = editing.second,
                    onValueChange = { renaming = pairing.id to it.take(60) },
                    label = { Text(playarrString(PlayarrString.RemoteRenameLabel)) },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    PlayarrButton(
                        onClick = {
                            viewModel.rename(pairing, editing.second)
                            renaming = null
                        },
                        enabled = editing.second.isNotBlank(),
                    ) { Text(playarrString(PlayarrString.RemoteSave)) }
                    PlayarrButton(onClick = { renaming = null }, variant = PlayarrButtonVariant.Ghost) { Text(playarrString(PlayarrString.RemoteCancel)) }
                }
            }
        } else {
            Row(
                horizontalArrangement = Arrangement.SpaceBetween,
                modifier = Modifier.fillMaxWidth(),
            ) {
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        if (pairing.isTarget) pairing.controllerName else nameOf(pairing.targetDeviceId) ?: unknown,
                        color = WebInk,
                    )
                    Text(
                        (if (pairing.isTarget) "" else pairing.controllerName + "  ·  ") +
                            pairing.scopes.joinToString(", ") + "  ·  " + if (pairing.status == "pending") {
                            playarrString(PlayarrString.RemotePairingPending)
                        } else {
                            val fmt = java.text.DateFormat.getDateInstance(java.text.DateFormat.MEDIUM)
                            playarrString(
                                PlayarrString.RemotePairedOn,
                                "date" to fmt.format(java.util.Date(pairing.createdMs)),
                                "expires" to fmt.format(java.util.Date(pairing.expiresMs)),
                            )
                        },
                        color = WebInkMuted,
                        fontSize = 11.sp,
                    )
                }
                PlayarrButton(onClick = { renaming = pairing.id to pairing.controllerName }, variant = PlayarrButtonVariant.Ghost) {
                    Text(playarrString(PlayarrString.RemoteRename))
                }
                PlayarrButton(onClick = { viewModel.revoke(pairing) }, variant = PlayarrButtonVariant.Ghost) { Text(playarrString(PlayarrString.RemoteRevoke)) }
            }
        }
    }
}

private fun navPayload(key: String): JsonObject = buildJsonObject { put("key", key) }
/** D-pad, text entry and transport controls for one paired target, laid out for one-handed use. */
@Composable
private fun RemotePad(pairing: RemotePairing, targetName: String, onSend: (String, JsonObject) -> Unit) {
    var text by remember(pairing.id) { mutableStateOf("") }
    Text(playarrString(PlayarrString.RemotePadTitle, "name" to targetName), color = WebInk, fontWeight = FontWeight.SemiBold)
    if (RemoteCapability.Navigate in pairing.scopes) {
        Column(
            verticalArrangement = Arrangement.spacedBy(8.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            modifier = Modifier.fillMaxWidth(),
        ) {
            PadButton(PlayarrString.RemoteUp) { onSend("navigate", navPayload("up")) }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                PadButton(PlayarrString.RemoteLeft) { onSend("navigate", navPayload("left")) }
                PadButton(PlayarrString.RemoteSelect) { onSend("navigate", navPayload("select")) }
                PadButton(PlayarrString.RemoteRight) { onSend("navigate", navPayload("right")) }
            }
            PadButton(PlayarrString.RemoteDown) { onSend("navigate", navPayload("down")) }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                PadButton(PlayarrString.RemoteBack, subdued = true) { onSend("navigate", navPayload("back")) }
                PadButton(PlayarrString.RemoteHome, subdued = true) { onSend("navigate", navPayload("home")) }
            }
        }
    }
    if (RemoteCapability.Playback in pairing.scopes) {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
            PadButton(PlayarrString.RemoteRewind, modifier = Modifier.weight(1f), subdued = true) {
                onSend("playback", buildJsonObject { put("action", "seek_by"); put("delta_ms", -10_000L) })
            }
            PadButton(PlayarrString.RemotePlayPause, modifier = Modifier.weight(1.6f)) {
                onSend("playback", buildJsonObject { put("action", "toggle") })
            }
            PadButton(PlayarrString.RemoteForward, modifier = Modifier.weight(1f), subdued = true) {
                onSend("playback", buildJsonObject { put("action", "seek_by"); put("delta_ms", 10_000L) })
            }
            PadButton(PlayarrString.RemoteStop, modifier = Modifier.weight(1f), subdued = true) {
                onSend("playback", buildJsonObject { put("action", "stop") })
            }
        }
    }
    if (RemoteCapability.Text in pairing.scopes) {
        OutlinedTextField(
            value = text,
            onValueChange = {
                text = it
                // Mirror typing live so the TV field tracks the phone keyboard.
                onSend("text", buildJsonObject { put("value", it); put("mode", "replace") })
            },
            placeholder = { Text(playarrString(PlayarrString.RemoteTextHint)) },
            singleLine = true,
            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Send, autoCorrectEnabled = false),
            keyboardActions = KeyboardActions(onSend = {
                onSend("text", buildJsonObject { put("value", text); put("mode", "replace"); put("submit", true) })
                text = ""
            }),
            modifier = Modifier.fillMaxWidth(),
        )
    }
}

@Composable
private fun PadButton(
    label: PlayarrString,
    modifier: Modifier = Modifier.width(96.dp),
    subdued: Boolean = false,
    onClick: () -> Unit,
) {
    val sized = modifier.defaultMinSize(minHeight = 52.dp)
    if (subdued) {
        PlayarrButton(onClick = onClick, modifier = sized, contentPadding = PaddingValues(horizontal = 8.dp), variant = PlayarrButtonVariant.Secondary) {
            Text(playarrString(label), maxLines = 1, fontSize = 13.sp)
        }
    } else {
        PlayarrButton(onClick = onClick, modifier = sized, contentPadding = PaddingValues(horizontal = 8.dp)) {
            Text(playarrString(label), maxLines = 1, fontSize = 15.sp)
        }
    }
}

/** On-device approval of a phone-remote pairing request; pairing alone grants nothing. */
@Composable
internal fun RemotePairingPrompt(controller: RemoteController) {
    val pending by controller.pendingPairings.collectAsState()
    val request: RemotePairingRequest = pending.firstOrNull() ?: return
    val scope = rememberCoroutineScope()
    var busy by remember(request.pairingId) { mutableStateOf(false) }
    // A TV remote needs a focused control inside the dialog or its key presses
    // fall through to the screen behind it.
    val allowFocus = remember(request.pairingId) { androidx.compose.ui.focus.FocusRequester() }
    LaunchedEffect(request.pairingId) {
        delay(150L)
        runCatching { allowFocus.requestFocus() }
    }
    PlayarrPanel(
        onDismissRequest = {},
        dismissible = false,
        title = {
            Text(
                playarrString(
                    PlayarrString.RemotePromptTitle,
                    "name" to request.controllerName.ifBlank { playarrString(PlayarrString.RemotePromptUnnamed) },
                ),
            )
        },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text(request.verificationCode, fontSize = 40.sp, fontWeight = FontWeight.Medium, letterSpacing = 8.sp)
                Text(playarrString(PlayarrString.RemotePromptHint))
            }
        },
        confirmButton = {
            PlayarrButton(
                enabled = !busy,
                modifier = Modifier.focusRequester(allowFocus),
                onClick = {
                    busy = true
                    scope.launch { runCatching { controller.approve(request) }; busy = false }
                },
            ) { Text(playarrString(PlayarrString.RemotePromptAllow)) }
        },
        dismissButton = {
            PlayarrButton(
                enabled = !busy,
                onClick = {
                busy = true
                scope.launch { controller.deny(request); busy = false }
            },
                variant = PlayarrButtonVariant.Secondary,
) { Text(playarrString(PlayarrString.RemotePromptDeny)) }
        },
    )
}

private sealed interface PlayOnPhase {
    data object Choose : PlayOnPhase
    data class Busy(val target: RemoteTarget, val progress: HandoffProgress) : PlayOnPhase
    data class Done(val target: RemoteTarget) : PlayOnPhase
    data class Error(val message: String) : PlayOnPhase
}

/** "Play on another device": moves the current title to another device of this account. */
@Composable
internal fun PlayOnDeviceDialog(
    onDismiss: () -> Unit,
    viewModel: RemoteViewModel = hiltViewModel(),
) {
    var selfId by remember { mutableStateOf<String?>(null) }
    var targets by remember { mutableStateOf<List<RemoteTarget>?>(null) }
    var phase by remember { mutableStateOf<PlayOnPhase>(PlayOnPhase.Choose) }
    val scope = rememberCoroutineScope()
    val notReady = playarrString(PlayarrString.RemotePlayOnNotReady)
    val unknown = playarrString(PlayarrString.RemotePlayOnUnknown)
    LaunchedEffect(Unit) {
        val (me, list) = viewModel.listCandidates()
        selfId = me
        targets = list
    }
    val candidates = targets.orEmpty().filter { !it.isSelf && it.online && RemoteCapability.Handoff in it.capabilities }
    PlayarrPanel(
        onDismissRequest = onDismiss,
        title = { Text(playarrString(PlayarrString.RemotePlayOnTitle)) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                when (val current = phase) {
                    PlayOnPhase.Choose -> {
                        if (targets == null) Text(playarrString(PlayarrString.RemotePlayOnLoading))
                        else if (candidates.isEmpty()) Text(playarrString(PlayarrString.RemotePlayOnNone))
                        candidates.forEach { target ->
                            PlayarrButton(
                                modifier = Modifier.fillMaxWidth(),
                                onClick = {
                                    val controls = viewModel.controller.bridge?.playerControls()
                                    val source = selfId
                                    if (controls == null || source == null) {
                                        phase = PlayOnPhase.Error(notReady)
                                        return@PlayarrButton
                                    }
                                    phase = PlayOnPhase.Busy(target, HandoffProgress.Offering)
                                    scope.launch {
                                        phase = try {
                                            viewModel.handOff(source, target, controls) { progress ->
                                                phase = PlayOnPhase.Busy(target, progress)
                                            }
                                            PlayOnPhase.Done(target)
                                        } catch (cancel: kotlinx.coroutines.CancellationException) {
                                            throw cancel
                                        } catch (failure: HandoffFailure) {
                                            PlayOnPhase.Error(failure.message ?: unknown)
                                        } catch (_: Exception) {
                                            PlayOnPhase.Error(unknown)
                                        }
                                    }
                                },
                                variant = PlayarrButtonVariant.Secondary,
                            ) { Text(target.name) }
                        }
                    }
                    is PlayOnPhase.Busy -> Text(
                        when (val progress = current.progress) {
                            is HandoffProgress.Pairing -> playarrString(
                                PlayarrString.RemotePlayOnPairing,
                                "name" to current.target.name,
                                "code" to progress.verificationCode.orEmpty(),
                            )
                            HandoffProgress.Waiting -> playarrString(PlayarrString.RemotePlayOnWaiting, "name" to current.target.name)
                            HandoffProgress.Offering -> playarrString(PlayarrString.RemotePlayOnOffering, "name" to current.target.name)
                        },
                    )
                    is PlayOnPhase.Done -> Text(playarrString(PlayarrString.RemotePlayOnDone, "name" to current.target.name))
                    is PlayOnPhase.Error -> Text(
                        playarrString(PlayarrString.RemotePlayOnFailed, "reason" to current.message),
                        color = MaterialTheme.colorScheme.error,
                    )
                }
            }
        },
        confirmButton = { PlayarrButton(onClick = onDismiss) { Text(playarrString(PlayarrString.RemotePlayOnClose)) } },
    )
}

/**
 * Keeps this device reachable as a remote target while the experience is on
 * screen: full control when the person opted in (default on TV), otherwise
 * handoff-only while something is playing. Also hosts the approval prompt.
 */
@Composable
internal fun PlayarrRemoteHostEffect(
    controller: RemoteController,
    playerActive: Boolean,
    signedIn: Boolean,
    activity: () -> Activity?,
    navController: NavHostController,
    startPlayback: (mediaFileId: String, startPositionMs: Long) -> Unit,
    playerControls: () -> RemotePlayerControls?,
) {
    val hostEnabled by controller.hostEnabled.collectAsState()
    val currentActivity by androidx.compose.runtime.rememberUpdatedState(activity)
    val currentStart by androidx.compose.runtime.rememberUpdatedState(startPlayback)
    val currentControls by androidx.compose.runtime.rememberUpdatedState(playerControls)
    DisposableEffect(controller, navController) {
        controller.bridge = object : RemoteUiBridge {
            override fun activity(): Activity? = currentActivity()
            override fun goHome() {
                navController.navigate("home") {
                    popUpTo(navController.graph.startDestinationId) { saveState = false }
                    launchSingleTop = true
                }
            }
            override fun startPlayback(mediaFileId: String, startPositionMs: Long) {
                currentStart(mediaFileId, startPositionMs)
                navController.navigate("experience-player/${Uri.encode(mediaFileId)}")
            }
            override fun playerControls(): RemotePlayerControls? = currentControls()
        }
        onDispose { controller.bridge = null }
    }
    val active = signedIn && (hostEnabled || playerActive)
    LaunchedEffect(active, hostEnabled) {
        if (active) controller.runHost(fullControl = hostEnabled)
    }
    if (signedIn) RemotePairingPrompt(controller)
}


/** The app's player seen through the remote-control seam: source-time positions, queue and tracks. */
internal class ExperienceRemotePlayerControls(
    private val queue: () -> PlayarrPlaybackQueue,
    private val playerViewModel: ExperiencePlayerViewModel,
    private val experience: PlayarrExperienceViewModel,
    private val onStopped: () -> Unit = {},
) : RemotePlayerControls {
    private val player get() = playerViewModel.player

    override val mediaFileId: String get() = queue().currentMediaFileId.orEmpty()
    override fun positionMs(): Long = playerViewModel.currentSourcePositionMs()
    override fun durationMs(): Long = playerViewModel.currentSourceDurationMs()
    override fun isPaused(): Boolean = !player.state.value.playWhenReady
    override fun isReady(): Boolean {
        val state = player.state.value
        return durationMs() > 0L && state.error == null && !state.hasEnded
    }

    override fun hasStarted(): Boolean {
        val state = player.state.value
        return handoffDestinationStarted(
            ready = isReady(),
            buffering = state.isBuffering,
            playing = state.isPlaying,
            playWhenReady = state.playWhenReady,
            ownsSession = playerViewModel.hasActiveSessionFor(mediaFileId),
        )
    }

    override fun play() = player.play()
    override fun pause() = player.pause()
    override fun seekToMs(positionMs: Long) = playerViewModel.seekToSourcePosition(positionMs)

    /** Volume belongs to the device (TV remote, phone buttons); not controllable from here. */
    override fun setVolume(level: Float): Boolean = false

    override fun stop() {
        playerViewModel.stopPlayback()
        experience.clearPlayback()
        onStopped()
    }

    override fun next(): Boolean {
        if (!queue().canNext) return false
        experience.movePlayback(1)
        return true
    }

    override fun previous(): Boolean {
        if (!queue().canPrevious) return false
        experience.movePlayback(-1)
        return true
    }

    override fun setAudioLanguage(language: String): Boolean {
        val track = playerViewModel.controls.value.audioTracks
            .firstOrNull { it.language?.startsWith(language, ignoreCase = true) == true } ?: return false
        playerViewModel.selectAudioTrack(track.id)
        return true
    }

    override fun setSubtitleLanguage(language: String?): Boolean {
        if (language == null) {
            playerViewModel.selectSubtitleTrack(null)
            return true
        }
        val track = playerViewModel.controls.value.subtitleTracks
            .firstOrNull { it.language?.startsWith(language, ignoreCase = true) == true } ?: return false
        playerViewModel.selectSubtitleTrack(track.id)
        return true
    }
}
