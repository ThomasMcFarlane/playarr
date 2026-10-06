package io.playarr.mobile.remote

import android.app.Activity
import android.content.Context
import android.os.SystemClock
import android.view.InputDevice
import android.view.KeyCharacterMap
import android.view.KeyEvent
import dagger.hilt.android.qualifiers.ApplicationContext
import io.playarr.mobile.isTelevision
import io.playarr.shared.data.model.AckRemoteEventRequest
import io.playarr.shared.data.model.AckRemoteHandoffRequest
import io.playarr.shared.data.model.RegisterRemoteTargetRequest
import io.playarr.shared.data.model.RemoteInbox
import io.playarr.shared.data.model.RemoteInboxEvent
import io.playarr.shared.data.model.ReportRemoteStateRequest
import io.playarr.shared.data.remote.PlayarrHttpClient
import io.playarr.shared.data.remote.PlayarrRemoteApi
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/** What the running UI offers the remote host: the activity, navigation and the player. */
interface RemoteUiBridge {
    fun activity(): Activity?
    fun goHome()
    fun startPlayback(mediaFileId: String, startPositionMs: Long)
    fun playerControls(): RemotePlayerControls?
}

/**
 * Process-wide owner of the target side of the phone remote
 * (`docs/architecture/remote-control.md`): the pending on-screen approvals, the
 * opt-in setting and the long-poll host. The host only runs while the Compose
 * effect that calls [runHost] is in composition, so it follows the app lifecycle.
 */
@Singleton
class RemoteController @Inject constructor(
    @ApplicationContext private val context: Context,
    private val api: PlayarrRemoteApi,
) {
    private val prefs = context.getSharedPreferences("playarr_remote", Context.MODE_PRIVATE)
    private val television = isTelevision(context)

    private val _hostEnabled = MutableStateFlow(prefs.getBoolean(KEY_HOST_ENABLED, television))
    val hostEnabled: StateFlow<Boolean> = _hostEnabled.asStateFlow()

    private val _pending = MutableStateFlow<List<RemotePairingRequest>>(emptyList())
    val pendingPairings: StateFlow<List<RemotePairingRequest>> = _pending.asStateFlow()

    @Volatile
    var bridge: RemoteUiBridge? = null

    fun setHostEnabled(enabled: Boolean) {
        prefs.edit().putBoolean(KEY_HOST_ENABLED, enabled).apply()
        _hostEnabled.value = enabled
    }

    suspend fun approve(request: RemotePairingRequest) {
        api.approvePairing(request.pairingId)
        dismiss(request.pairingId)
    }

    suspend fun deny(request: RemotePairingRequest) {
        runCatching { api.denyPairing(request.pairingId) }
        dismiss(request.pairingId)
    }

    private fun dismiss(pairingId: String) = _pending.update { list -> list.filterNot { it.pairingId == pairingId } }

    /**
     * Runs the target host until cancelled. [fullControl] advertises every
     * capability this client can execute; otherwise only handoff is offered,
     * so a title that is merely playing can still be moved elsewhere.
     */
    suspend fun runHost(fullControl: Boolean) {
        val capabilities = if (fullControl) ANDROID_TARGET_CAPABILITIES else HANDOFF_ONLY_CAPABILITIES
        val host = RemoteTargetHost(
            api = Api(),
            handlers = Handlers(),
            name = deviceName(),
            platform = if (television) "android-tv" else "android-mobile",
            capabilities = capabilities,
        )
        coroutineScope {
            host.start(this)
            try {
                awaitCancellation()
            } finally {
                host.stop()
            }
        }
    }

    fun deviceName(): String = if (television) {
        android.os.Build.MODEL?.takeIf { it.isNotBlank() }?.let { "Android TV ($it)" } ?: "Android TV"
    } else {
        android.os.Build.MODEL?.takeIf { it.isNotBlank() } ?: "Android phone"
    }

    private inner class Api : RemoteTargetApi {
        override suspend fun register(request: RegisterRemoteTargetRequest) {
            api.registerTarget(request)
        }

        override suspend fun inbox(after: Long, wait: Int): RemoteInbox = api.inbox(after, wait)

        override suspend fun stream(after: Long, onOpen: () -> Unit, onEvent: suspend (RemoteInboxEvent) -> Unit) {
            val body = api.stream(after)
            // An older server (or a proxy) answers unknown paths with its HTML app shell.
            if (body.contentType()?.subtype != "event-stream") {
                body.close()
                throw PushUnsupportedException("not an event stream")
            }
            withContext(Dispatchers.IO) {
                // Blocking reads are not cancellable; closing the body unblocks them.
                val closer = coroutineContext[kotlinx.coroutines.Job]!!.invokeOnCompletion { body.close() }
                try {
                    onOpen()
                    body.charStream().buffered().use { reader ->
                        readSseFrames(reader) { name, data ->
                            if (name != "inbox") return@readSseFrames
                            val event = runCatching {
                                PlayarrHttpClient.json.decodeFromString(RemoteInboxEvent.serializer(), data)
                            }.getOrNull() ?: return@readSseFrames
                            onEvent(event)
                        }
                    }
                } catch (error: java.io.IOException) {
                    // Closed by cancellation: not an error to report.
                    if (!isActive) throw kotlinx.coroutines.CancellationException() else throw error
                } finally {
                    closer.dispose()
                    body.close()
                }
            }
        }

        override suspend fun ackEvent(eventId: String, request: AckRemoteEventRequest) {
            api.ackEvent(eventId, request)
        }

        override suspend fun ackHandoff(handoffId: String, request: AckRemoteHandoffRequest) {
            api.ackHandoff(handoffId, request)
        }

        override suspend fun reportState(request: ReportRemoteStateRequest) {
            api.reportState(request)
        }
    }

    private inner class Handlers : RemoteTargetHandlers {
        override fun onPairingRequest(request: RemotePairingRequest) {
            _pending.update { list -> if (list.any { it.pairingId == request.pairingId }) list else list + request }
        }

        override fun onPairingRevoked(pairingId: String) = dismiss(pairingId)

        override suspend fun execute(kind: String, args: JsonObject): RemoteOutcome = withContext(Dispatchers.Main) {
            val ui = bridge ?: return@withContext RemoteOutcome.Failed("app is not ready")
            when (kind) {
                "navigate" -> navigate(ui, args)
                "text" -> {
                    val activity = ui.activity() ?: return@withContext RemoteOutcome.Failed("app is not ready")
                    RemoteTextInjector.inject(activity, parseTextCommand(args))
                }
                "playback" -> executePlaybackCommand(ui.playerControls(), args)
                else -> RemoteOutcome.Unsupported("capability not available")
            }
        }

        override suspend fun onHandoffOffer(offer: RemoteHandoffOffer): RemoteHandoffResult {
            val received = SystemClock.elapsedRealtime()
            withContext(Dispatchers.Main) {
                bridge?.startPlayback(offer.mediaFileId, offer.positionMs)
            }
            val deadline = received + HANDOFF_START_TIMEOUT_MS
            var compensated = offer.paused
            while (SystemClock.elapsedRealtime() < deadline) {
                val started = withContext(Dispatchers.Main) {
                    val player = bridge?.playerControls()
                    if (player != null && player.mediaFileId == offer.mediaFileId && player.hasStarted()) {
                        if (!compensated) {
                            // The source kept playing while this device prepared; catch up once so the
                            // acknowledged position is where the source would be now.
                            val behindMs = SystemClock.elapsedRealtime() - received
                            compensated = true
                            if (behindMs > CATCH_UP_THRESHOLD_MS) {
                                player.seekToMs(offer.positionMs + behindMs)
                                return@withContext null
                            }
                        }
                        if (offer.paused) player.pause() else player.play()
                        player
                    } else {
                        null
                    }
                }
                if (started != null) {
                    // Give the engine a beat so the acknowledged position is the started one.
                    delay(HANDOFF_START_SETTLE_MS)
                    return RemoteHandoffResult.Playing(withContext(Dispatchers.Main) { started.positionMs() })
                }
                delay(HANDOFF_START_POLL_MS)
            }
            return RemoteHandoffResult.Failed("playback did not start in time")
        }

        override suspend fun onHandoffStop(handoffId: String) {
            val ui = bridge ?: return
            withContext(Dispatchers.Main) { ui.playerControls()?.stop() }
        }

        override fun currentState(): JsonElement? {
            val player = bridge?.playerControls() ?: return null
            if (!player.isReady()) return null
            return JsonObject(
                mapOf(
                    "media_file_id" to JsonPrimitive(player.mediaFileId),
                    "position_ms" to JsonPrimitive(player.positionMs()),
                    "duration_ms" to JsonPrimitive(player.durationMs()),
                    "paused" to JsonPrimitive(player.isPaused()),
                ),
            )
        }
    }

    private fun navigate(ui: RemoteUiBridge, args: JsonObject): RemoteOutcome {
        val key = remoteKeyFor(args.string("key").orEmpty()) ?: return RemoteOutcome.Unsupported("unsupported key")
        if (key == RemoteKey.Home) {
            ui.goHome()
            return RemoteOutcome.Ok
        }
        val activity = ui.activity() ?: return RemoteOutcome.Failed("app is not ready")
        val code = when (key) {
            RemoteKey.Up -> KeyEvent.KEYCODE_DPAD_UP
            RemoteKey.Down -> KeyEvent.KEYCODE_DPAD_DOWN
            RemoteKey.Left -> KeyEvent.KEYCODE_DPAD_LEFT
            RemoteKey.Right -> KeyEvent.KEYCODE_DPAD_RIGHT
            RemoteKey.Select -> KeyEvent.KEYCODE_DPAD_CENTER
            RemoteKey.Back -> KeyEvent.KEYCODE_BACK
            RemoteKey.Home -> return RemoteOutcome.Ok
        }
        // Deliver through the decor view exactly as the input pipeline does, and
        // mark the events as coming from a D-pad: Compose focus traversal ignores
        // events with no source.
        val decor = activity.window?.decorView ?: return RemoteOutcome.Failed("app is not ready")
        // Events handed straight to the decor view skip the framework's focus bootstrap: with
        // no view focused (a TV app nobody has pressed a key in yet) Compose never sees them and
        // the first remote presses are silently lost. Give the view tree focus first, as the
        // first physical key press would.
        if (decor.findFocus() == null) decor.requestFocus(android.view.View.FOCUS_DOWN)
        val downTime = SystemClock.uptimeMillis()
        fun key(action: Int) = KeyEvent(
            downTime,
            SystemClock.uptimeMillis(),
            action,
            code,
            0,
            0,
            KeyCharacterMap.VIRTUAL_KEYBOARD,
            0,
            KeyEvent.FLAG_FROM_SYSTEM,
            InputDevice.SOURCE_KEYBOARD or InputDevice.SOURCE_DPAD,
        )
        decor.dispatchKeyEvent(key(KeyEvent.ACTION_DOWN))
        decor.dispatchKeyEvent(key(KeyEvent.ACTION_UP))
        return RemoteOutcome.Ok
    }

    private companion object {
        const val KEY_HOST_ENABLED = "host_enabled"
        const val HANDOFF_START_TIMEOUT_MS = 40_000L
        /** How often a handoff destination checks whether playback has started (each tick costs up to this much latency). */
        const val HANDOFF_START_POLL_MS = 100L
        /** Pause after playback starts so the acknowledged position is the started one. */
        const val HANDOFF_START_SETTLE_MS = 150L
        const val CATCH_UP_THRESHOLD_MS = 1_500L
    }
}
