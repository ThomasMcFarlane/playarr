package io.playarr.mobile.remote

import io.playarr.shared.data.model.AckRemoteEventRequest
import io.playarr.shared.data.model.AckRemoteHandoffRequest
import io.playarr.shared.data.model.RegisterRemoteTargetRequest
import io.playarr.shared.data.model.RemoteInbox
import io.playarr.shared.data.model.RemoteInboxEvent
import io.playarr.shared.data.model.ReportRemoteStateRequest
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import retrofit2.HttpException

/** The slice of `PlayarrRemoteApi` the target loop needs (a seam for tests). */
interface RemoteTargetApi {
    suspend fun register(request: RegisterRemoteTargetRequest)
    suspend fun inbox(after: Long, wait: Int): RemoteInbox
    suspend fun ackEvent(eventId: String, request: AckRemoteEventRequest)
    suspend fun ackHandoff(handoffId: String, request: AckRemoteHandoffRequest)
    suspend fun reportState(request: ReportRemoteStateRequest)

    /**
     * Push transport: calls [onOpen] once the stream is up, then [onEvent] for each
     * event, and returns when the server ends the stream. Throws
     * [PushUnsupportedException] when push cannot work here.
     */
    suspend fun stream(after: Long, onOpen: () -> Unit, onEvent: suspend (RemoteInboxEvent) -> Unit) {
        throw PushUnsupportedException("push is not available")
    }
}

data class RemotePairingRequest(
    val pairingId: String,
    val controllerName: String,
    val verificationCode: String,
    val scopes: List<String>,
)

data class RemoteHandoffOffer(
    val handoffId: String,
    val mediaFileId: String,
    val workId: String,
    val positionMs: Long,
    val paused: Boolean,
    val audioLanguage: String?,
    val subtitleLanguage: String?,
)

sealed interface RemoteHandoffResult {
    data class Playing(val positionMs: Long) : RemoteHandoffResult
    data class Failed(val reason: String) : RemoteHandoffResult
}

interface RemoteTargetHandlers {
    fun onPairingRequest(request: RemotePairingRequest)
    fun onPairingRevoked(pairingId: String)
    suspend fun execute(kind: String, args: JsonObject): RemoteOutcome
    suspend fun onHandoffOffer(offer: RemoteHandoffOffer): RemoteHandoffResult
    suspend fun onHandoffStop(handoffId: String)
    /** Current playback state to report for handoff, or null when idle. */
    fun currentState(): JsonElement?
}

/**
 * Loop that makes this device a remote-control target. Mirrors the web
 * client's `RemoteTargetHost`: register, then prefer the server-sent-events push
 * stream and fall back to long polling the inbox from the last cursor, execute
 * and acknowledge each event, back off on errors and re-register when the
 * server forgets the target.
 */
class RemoteTargetHost(
    private val api: RemoteTargetApi,
    private val handlers: RemoteTargetHandlers,
    private val name: String,
    private val platform: String,
    private val capabilities: List<String>,
    private val pollSeconds: Int = 20,
    private val stateIntervalMs: Long = 5_000L,
    private val pushRetryMs: Long = 120_000L,
    private val clock: () -> Long = System::currentTimeMillis,
    private val fingerprint: String? = null,
) {
    private var pushFailures = 0
    private var pushDisabledUntil = 0L

    /** Transport in use right now: `push` or `poll` (diagnostics and tests). */
    @Volatile
    var transport: String = "poll"
        private set

    private var job: Job? = null
    private var stateJob: Job? = null
    private var after = 0L
    private var lastStateJson = ""
    private var lastStateSentAt = 0L

    fun start(scope: CoroutineScope) {
        if (job?.isActive == true) return
        job = scope.launch { loop(this) }
        stateJob = scope.launch {
            while (isActive) {
                delay(stateIntervalMs)
                reportState()
            }
        }
    }

    fun stop() {
        job?.cancel()
        stateJob?.cancel()
        job = null
        stateJob = null
    }

    suspend fun reportState() {
        val state = handlers.currentState() ?: return
        val json = state.toString()
        val now = System.currentTimeMillis()
        if (json == lastStateJson && now - lastStateSentAt < 15_000L) return
        try {
            api.reportState(ReportRemoteStateRequest(state))
            lastStateJson = json
            lastStateSentAt = now
        } catch (cancel: CancellationException) {
            throw cancel
        } catch (_: Exception) {
            // Best effort; the next tick retries.
        }
    }

    private suspend fun loop(scope: CoroutineScope) {
        var backoffMs = 1_000L
        var registered = false
        while (scope.isActive) {
            try {
                if (!registered) {
                    api.register(RegisterRemoteTargetRequest(name, platform, capabilities, fingerprint))
                    registered = true
                }
                if (clock() >= pushDisabledUntil) {
                    runPush(scope)
                    backoffMs = 1_000L
                    continue
                }
                transport = "poll"
                val inbox = api.inbox(after, pollSeconds)
                backoffMs = 1_000L
                for (event in inbox.events) handle(event, scope)
                after = maxOf(after, inbox.next)
            } catch (cancel: CancellationException) {
                throw cancel
            } catch (error: Exception) {
                if ((error as? HttpException)?.code() == 404) registered = false
                delay(backoffMs)
                backoffMs = minOf(backoffMs * 2, 15_000L)
            }
        }
    }

    /** One push session; returns when the server ends it normally. */
    private suspend fun runPush(scope: CoroutineScope) {
        var opened = false
        val startedAt = clock()
        var delivered = false
        try {
            api.stream(
                after,
                onOpen = {
                    opened = true
                    pushFailures = 0
                    transport = "push"
                },
                onEvent = { event ->
                    delivered = true
                    handle(event, scope)
                    after = maxOf(after, event.seq)
                },
            )
        } catch (cancel: CancellationException) {
            throw cancel
        } catch (error: Exception) {
            if (!scope.isActive) throw CancellationException()
            // 404 can mean "not registered" (the loop re-registers) or an older server
            // without the stream route; counting it lets the host settle on long polling.
            if (!opened) {
                pushFailures += 1
                // Streaming is blocked or unsupported on this path: long-poll for a while, then retry push.
                if (error is PushUnsupportedException || pushFailures >= 3) {
                    pushFailures = 0
                    pushDisabledUntil = clock() + pushRetryMs
                    transport = "poll"
                    return
                }
            }
            throw error
        }
        // A stream that closed without ever opening, or at once, would otherwise spin.
        if (!opened || (!delivered && clock() - startedAt < 2_000L)) {
            pushFailures += 1
            if (pushFailures >= 3) {
                pushFailures = 0
                pushDisabledUntil = clock() + pushRetryMs
                transport = "poll"
                return
            }
            throw java.io.IOException("push stream closed immediately")
        }
    }

    suspend fun handle(event: RemoteInboxEvent, scope: CoroutineScope) {
        val payload = event.payload.asObject()
        try {
            when (event.kind) {
                "pairing_request" -> {
                    handlers.onPairingRequest(
                        RemotePairingRequest(
                            pairingId = payload.string("pairing_id") ?: event.pairingId.orEmpty(),
                            controllerName = payload.string("controller_name").orEmpty(),
                            verificationCode = payload.string("verification_code").orEmpty(),
                            scopes = (payload["scopes"] as? kotlinx.serialization.json.JsonArray)
                                ?.mapNotNull { (it as? kotlinx.serialization.json.JsonPrimitive)?.content }
                                .orEmpty(),
                        ),
                    )
                    ack(event.id, RemoteOutcome.Ok)
                }
                "pairing_revoked" -> {
                    handlers.onPairingRevoked(payload.string("pairing_id") ?: event.pairingId.orEmpty())
                    ack(event.id, RemoteOutcome.Ok)
                }
                "command" -> {
                    val outcome = handlers.execute(payload.string("kind").orEmpty(), payload["args"].asObject())
                    ack(event.id, outcome)
                }
                "handoff_offer" -> {
                    val offer = parseHandoffOffer(payload)
                    if (offer == null) {
                        ack(event.id, RemoteOutcome.Failed("malformed offer"))
                    } else {
                        // Do not block the inbox while the destination starts playback.
                        scope.launch { runOffer(offer) }
                        ack(event.id, RemoteOutcome.Ok)
                    }
                }
                "handoff_stop" -> {
                    handlers.onHandoffStop(payload.string("handoff_id").orEmpty())
                    ack(event.id, RemoteOutcome.Ok)
                }
                else -> ack(event.id, RemoteOutcome.Unsupported("unknown event"))
            }
        } catch (cancel: CancellationException) {
            throw cancel
        } catch (_: Exception) {
            ack(event.id, RemoteOutcome.Failed("handler error"))
        }
    }

    private suspend fun runOffer(offer: RemoteHandoffOffer) {
        val result = try {
            handlers.onHandoffOffer(offer)
        } catch (cancel: CancellationException) {
            throw cancel
        } catch (_: Exception) {
            RemoteHandoffResult.Failed("playback failed to start")
        }
        try {
            api.ackHandoff(
                offer.handoffId,
                when (result) {
                    is RemoteHandoffResult.Playing ->
                        AckRemoteHandoffRequest("playing", positionMs = result.positionMs.coerceAtLeast(0L))
                    is RemoteHandoffResult.Failed -> AckRemoteHandoffRequest("failed", reason = result.reason)
                },
            )
        } catch (cancel: CancellationException) {
            throw cancel
        } catch (_: Exception) {
            // The offer expires server-side and the source keeps playing.
        }
    }

    private suspend fun ack(eventId: String, outcome: RemoteOutcome) {
        try {
            api.ackEvent(eventId, AckRemoteEventRequest(outcome.wire, outcome.detailOrNull))
        } catch (cancel: CancellationException) {
            throw cancel
        } catch (_: Exception) {
            // Already acknowledged or expired.
        }
    }
}

internal fun parseHandoffOffer(payload: JsonObject): RemoteHandoffOffer? {
    val handoffId = payload.string("handoff_id") ?: return null
    val mediaFileId = payload.string("media_file_id") ?: return null
    val snapshot = payload["snapshot"].asObject()
    return RemoteHandoffOffer(
        handoffId = handoffId,
        mediaFileId = mediaFileId,
        workId = payload.string("work_id").orEmpty(),
        positionMs = snapshot.long("position_ms") ?: 0L,
        paused = (snapshot["paused"] as? kotlinx.serialization.json.JsonPrimitive)?.content == "true",
        audioLanguage = snapshot.string("audio_language"),
        subtitleLanguage = snapshot.string("subtitle_language"),
    )
}
