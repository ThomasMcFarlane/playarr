package io.streamarr.mobile.cast

import android.content.Context
import android.util.Log
import androidx.mediarouter.media.MediaRouteSelector
import androidx.mediarouter.media.MediaRouter
import com.google.android.gms.cast.Cast
import com.google.android.gms.cast.CastDevice
import com.google.android.gms.cast.CastMediaControlIntent
import com.google.android.gms.cast.CastStatusCodes
import com.google.android.gms.cast.MediaInfo
import com.google.android.gms.cast.MediaLoadRequestData
import com.google.android.gms.cast.MediaSeekOptions
import com.google.android.gms.cast.framework.CastContext
import com.google.android.gms.cast.framework.CastReasonCodes
import com.google.android.gms.cast.framework.CastSession
import com.google.android.gms.cast.framework.SessionManagerListener
import dagger.hilt.android.qualifiers.ApplicationContext
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import org.json.JSONObject

/** A cast-capable route the plain (non-AppCompat) device picker can render and select. */
data class PlayarrCastRoute(val id: String, val name: String)

sealed interface PlayarrCastConnectionState {
    /** No [CastContext] at all -- television, no Play services, or the Cast dynamic module failed to load. */
    data object Unavailable : PlayarrCastConnectionState
    data object NotConnected : PlayarrCastConnectionState
    data class Connecting(val deviceName: String?) : PlayarrCastConnectionState
    data class Connected(val deviceName: String?) : PlayarrCastConnectionState
}

/**
 * Wraps `SessionManager` plus a per-session message channel on
 * [PLAYARR_CAST_NAMESPACE], and a plain `MediaRouter`-backed route list for
 * a hand-rolled Compose device picker.
 *
 * This app's theme is not AppCompat (see `PlayarrCastOptionsProvider`'s
 * KDoc), so the stock `MediaRouteButton`/`MediaRouteChooserDialog` (both
 * AppCompat-derived) cannot be used here. The *core* `androidx.mediarouter`
 * types used below (`MediaRouter`, `MediaRouteSelector`, `RouteInfo`) are
 * plain, non-AppCompat classes in that same artifact -- only its `app`
 * sub-package UI widgets require AppCompat, and this file never touches
 * those. `androidx.mediarouter` itself is not declared directly in
 * `build.gradle.kts`; it arrives transitively via
 * `play-services-cast-framework`, which depends on it internally for
 * exactly this kind of route discovery.
 *
 * [castContext] is null wherever `di/CastModule.kt` couldn't resolve one
 * (television, no Play services, `ModuleUnavailableException`) -- every
 * public method below is a safe no-op in that case rather than throwing,
 * so callers never need to null-check before calling in.
 */
@Singleton
class PlayarrCastSession @Inject constructor(
    @ApplicationContext private val context: Context,
    private val castContext: CastContext?,
) : Cast.MessageReceivedCallback {

    val isAvailable: Boolean get() = castContext != null

    @Volatile private var activeSession: CastSession? = null
    @Volatile private var routerCallback: MediaRouter.Callback? = null
    @Volatile private var routeSelector: MediaRouteSelector? = null

    private val _connectionState = MutableStateFlow(
        if (castContext != null) PlayarrCastConnectionState.NotConnected else PlayarrCastConnectionState.Unavailable,
    )
    val connectionState: StateFlow<PlayarrCastConnectionState> = _connectionState.asStateFlow()

    private val _receiverState = MutableStateFlow<PlayarrCastStateMessage?>(null)
    val receiverState: StateFlow<PlayarrCastStateMessage?> = _receiverState.asStateFlow()

    /** Every parsed [PlayarrCastReceiverMessage], for one-shot reactions (e.g. `auth.rotated`) -- [receiverState] only tracks the latest `state`. */
    private val _events = MutableSharedFlow<PlayarrCastReceiverMessage>(extraBufferCapacity = 16)
    val events: SharedFlow<PlayarrCastReceiverMessage> = _events.asSharedFlow()

    private val _routes = MutableStateFlow<List<PlayarrCastRoute>>(emptyList())
    val routes: StateFlow<List<PlayarrCastRoute>> = _routes.asStateFlow()

    private val sessionManagerListener = object : SessionManagerListener<CastSession> {
        override fun onSessionStarting(session: CastSession) {
            _connectionState.value = PlayarrCastConnectionState.Connecting(session.castDevice?.friendlyName)
        }
        override fun onSessionStarted(session: CastSession, sessionId: String) = attach(session)
        override fun onSessionStartFailed(session: CastSession, error: Int) = detach(error)
        override fun onSessionResuming(session: CastSession, sessionId: String) {
            _connectionState.value = PlayarrCastConnectionState.Connecting(session.castDevice?.friendlyName)
        }
        override fun onSessionResumed(session: CastSession, wasSuspended: Boolean) = attach(session)
        override fun onSessionResumeFailed(session: CastSession, error: Int) = detach(error)
        override fun onSessionSuspended(session: CastSession, reason: Int) = Unit
        override fun onSessionEnding(session: CastSession) = Unit
        override fun onSessionEnded(session: CastSession, error: Int) = detach(error)
    }

    /** Starts listening for session lifecycle events. Call once the owning screen enters composition. */
    fun start() {
        val sessionManager = castContext?.sessionManager ?: return
        sessionManager.addSessionManagerListener(sessionManagerListener, CastSession::class.java)
        sessionManager.currentCastSession?.let(::attach)
    }

    /** Stops listening and any in-flight discovery. Call from the owning screen's teardown; safe even if [start] was never called. */
    fun stop() {
        castContext?.sessionManager?.removeSessionManagerListener(sessionManagerListener, CastSession::class.java)
        stopDiscovery()
    }

    private fun attach(session: CastSession) {
        activeSession = session
        // setMessageReceivedCallbacks can throw IOException at the Cast SDK
        // layer if the session is already torn down by the time this runs;
        // never worth crashing the app over.
        runCatching { session.setMessageReceivedCallbacks(PLAYARR_CAST_NAMESPACE, this) }
        _connectionState.value = PlayarrCastConnectionState.Connected(session.castDevice?.friendlyName)
    }

    private fun detach(statusCode: Int = CastStatusCodes.SUCCESS) {
        activeSession?.let { session -> runCatching { session.removeMessageReceivedCallbacks(PLAYARR_CAST_NAMESPACE) } }
        activeSession = null
        _receiverState.value = null
        _connectionState.value = if (castContext != null) {
            PlayarrCastConnectionState.NotConnected
        } else {
            PlayarrCastConnectionState.Unavailable
        }
        if (statusCode == CastStatusCodes.SUCCESS) return
        // CAST_CANCELLED is a normal user action (closed the device picker,
        // deliberately disconnected) -- not an error worth logging as one.
        val reason = castContext?.getCastReasonCodeForCastStatusCode(statusCode)
        if (reason != CastReasonCodes.CAST_CANCELLED) {
            Log.w(TAG, "Playarr Cast session ended abnormally: statusCode=$statusCode reason=$reason")
        }
    }

    /** Begins scanning for cast-capable routes advertising [receiverAppId]; observe [routes]. No-op when [isAvailable] is false. */
    fun startDiscovery(receiverAppId: String) {
        if (castContext == null || receiverAppId.isBlank()) return
        stopDiscovery()
        val selector = MediaRouteSelector.Builder()
            .addControlCategory(CastMediaControlIntent.categoryForCast(receiverAppId))
            .build()
        val router = MediaRouter.getInstance(context)
        val callback = object : MediaRouter.Callback() {
            override fun onRouteAdded(router: MediaRouter, route: MediaRouter.RouteInfo) = refreshRoutes(router, selector)
            override fun onRouteRemoved(router: MediaRouter, route: MediaRouter.RouteInfo) = refreshRoutes(router, selector)
            override fun onRouteChanged(router: MediaRouter, route: MediaRouter.RouteInfo) = refreshRoutes(router, selector)
        }
        router.addCallback(selector, callback, MediaRouter.CALLBACK_FLAG_PERFORM_ACTIVE_SCAN)
        routerCallback = callback
        routeSelector = selector
        refreshRoutes(router, selector)
    }

    /** Stops any in-flight discovery started by [startDiscovery]. Safe to call repeatedly. */
    fun stopDiscovery() {
        val callback = routerCallback ?: return
        MediaRouter.getInstance(context).removeCallback(callback)
        routerCallback = null
        routeSelector = null
        _routes.value = emptyList()
    }

    private fun refreshRoutes(router: MediaRouter, selector: MediaRouteSelector) {
        _routes.value = router.routes
            .filter { !it.isDefault && it.matchesSelector(selector) }
            .map { PlayarrCastRoute(it.id, it.name) }
    }

    /**
     * Selecting a route hands control straight to the Cast framework's own
     * `SessionManager` (it listens for `MediaRouter` route selection
     * internally once `CastContext` is initialised), which starts a
     * session and drives [sessionManagerListener] above -- this class never
     * calls `SessionManager.startSession` itself.
     */
    fun selectRoute(routeId: String) {
        MediaRouter.getInstance(context).routes.firstOrNull { it.id == routeId }?.select()
    }

    /** Ends the current cast session. [stopCasting] mirrors `SessionManager.endCurrentSession`'s own parameter: whether the receiver should also stop playback. */
    fun endSession(stopCasting: Boolean = true) {
        castContext?.sessionManager?.endCurrentSession(stopCasting)
    }

    /**
     * Sends [request] as the actual Cast `LOAD`, via `RemoteMediaClient` --
     * deliberately *not* the custom-namespace channel, since
     * [PlayarrCastLoadRequest] is not part of [PlayarrCastMessage] (see
     * that type's KDoc). The receiver's `PlayerManager` LOAD interceptor
     * reads the whole request back out of `MediaInfo.customData`, since
     * this is a fully self-negotiating load -- the sender never resolves
     * or sends a raw playback URL. Returns `false` if there is no
     * connected session to load onto.
     */
    fun loadMedia(request: PlayarrCastLoadRequest): Boolean {
        val remoteMediaClient = activeSession?.remoteMediaClient ?: return false
        val customData = JSONObject(playarrCastJson.encodeToString(PlayarrCastLoadRequest.serializer(), request))
        val mediaInfo = MediaInfo.Builder(request.item.mediaFileId)
            .setStreamType(MediaInfo.STREAM_TYPE_BUFFERED)
            .setContentType("application/octet-stream")
            .setCustomData(customData)
            .build()
        val loadRequest = MediaLoadRequestData.Builder()
            .setMediaInfo(mediaInfo)
            .setAutoplay(request.playback.autoplay)
            .setCurrentTime(request.playback.startPositionMs)
            .build()
        remoteMediaClient.load(loadRequest)
        return true
    }

    /**
     * Toggles play/pause via the *standard* Cast media protocol
     * (`RemoteMediaClient`), which the receiver's `PlayerManager` handles
     * natively -- transport controls are deliberately not reinvented on
     * the custom namespace; only Playarr-specific concepts (track/quality
     * selection by app id, queue, auth, state) go over that channel.
     */
    fun togglePlayback() {
        val client = activeSession?.remoteMediaClient ?: return
        if (client.isPlaying) client.pause() else client.play()
    }

    /** [enginePositionMs] must already be converted from source position via the receiver's last-known `sourceOffsetMs` -- see the design doc's Ground Truth on source vs. engine position. */
    fun seekTo(enginePositionMs: Long) {
        val client = activeSession?.remoteMediaClient ?: return
        client.seek(MediaSeekOptions.Builder().setPosition(enginePositionMs).build())
    }

    /** Sends [message] on [PLAYARR_CAST_NAMESPACE]; a no-op if no session is connected. */
    fun send(message: PlayarrCastSenderMessage) {
        val session = activeSession ?: return
        runCatching { session.sendMessage(PLAYARR_CAST_NAMESPACE, encodePlayarrCastMessage(message)) }
            .onFailure { Log.w(TAG, "Failed to send a Playarr Cast message", it) }
    }

    override fun onMessageReceived(castDevice: CastDevice, namespace: String, message: String) {
        val parsed = parsePlayarrCastMessage(message) as? PlayarrCastReceiverMessage ?: return
        if (parsed is PlayarrCastStateMessage) _receiverState.value = parsed
        _events.tryEmit(parsed)
    }

    private companion object {
        const val TAG = "PlayarrCastSession"
    }
}
