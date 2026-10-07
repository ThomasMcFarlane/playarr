package io.playarr.mobile.ui

import io.playarr.shared.designsystem.component.PlayarrButton
import io.playarr.shared.designsystem.component.PlayarrButtonVariant
import io.playarr.shared.designsystem.component.PlayarrIconButton
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.focusable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.automirrored.outlined.QueueMusic
import androidx.compose.material.icons.outlined.Cast
import androidx.compose.material.icons.outlined.Devices
import androidx.compose.material.icons.outlined.CastConnected
import androidx.compose.material.icons.outlined.HighQuality
import androidx.compose.material.icons.outlined.Info
import androidx.compose.material.icons.outlined.MusicNote
import androidx.compose.material.icons.outlined.Pause
import androidx.compose.material.icons.outlined.PictureInPictureAlt
import androidx.compose.material.icons.outlined.PlayArrow
import androidx.compose.material.icons.outlined.SkipNext
import androidx.compose.material.icons.outlined.SkipPrevious
import androidx.compose.material.icons.outlined.Subtitles
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.Slider
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.foundation.border
import androidx.compose.ui.draw.drawBehind
import androidx.compose.foundation.interaction.collectIsFocusedAsState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusDirection
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.layout.layout
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onKeyEvent
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.playarr.mobile.cast.PlayarrCastConnectionState
import io.playarr.mobile.cast.PlayarrCastRoute
import io.playarr.shared.player.PlaybackState
import kotlinx.coroutines.delay


/** CSS `ease`, as used by web's `.player-scrim` and `.player-controls` transitions. */
private val PlayerEaseEasing = CubicBezierEasing(0.25f, 0.1f, 0.25f, 1f)
private val PlayerScrimEnter = slideInVertically(tween(PLAYER_CONTROLS_ANIMATION_MS, easing = PlayerEaseEasing)) { it } +
    fadeIn(tween(PLAYER_CONTROLS_ANIMATION_MS, easing = PlayerEaseEasing))
private val PlayerScrimExit = slideOutVertically(tween(PLAYER_CONTROLS_ANIMATION_MS, easing = PlayerEaseEasing)) { it } +
    fadeOut(tween(PLAYER_CONTROLS_ANIMATION_MS, easing = PlayerEaseEasing))
internal val PlayerChromeFadeEnter = fadeIn(tween(PLAYER_CONTROLS_ANIMATION_MS, easing = PlayerEaseEasing))
internal val PlayerChromeFadeExit = fadeOut(tween(PLAYER_CONTROLS_ANIMATION_MS, easing = PlayerEaseEasing))

/**
 * The bottom scrim behind the controls. It rises from the bottom edge and recedes downward (web: translateY + opacity,
 * 240ms ease); it never grows from the middle. Any top gradient fades separately.
 */
@Composable
internal fun BoxScope.PlayarrPlayerScrim(visible: Boolean, fraction: Float = 0.48f) {
    AnimatedVisibility(
        visible = visible,
        enter = PlayerScrimEnter,
        exit = PlayerScrimExit,
        modifier = Modifier.align(Alignment.BottomCenter),
    ) {
        Box(
            Modifier
                .fillMaxWidth()
                .fillMaxHeight(fraction)
                .background(Brush.verticalGradient(listOf(Color.Transparent, Color.Black.copy(alpha = 0.92f)))),
        )
    }
}

internal enum class PlayarrPlayerMenu { Quality, Audio, Subtitles }
private enum class PlayarrPlayerFocusTarget { Back, Seek, Playlist, Quality, Play, Restore }

/** Focusable player controls register here so the controls can return focus to the last one when they reappear. */
private class PlayerFocusRegistry {
    val tracker = PlayarrPlayerFocusTracker()
    val requesters = mutableMapOf<String, FocusRequester>()
}

private val LocalPlayerFocusRegistry = androidx.compose.runtime.staticCompositionLocalOf { PlayerFocusRegistry() }

@Composable
private fun Modifier.playerTracked(key: String, requester: FocusRequester? = null): Modifier {
    val registry = LocalPlayerFocusRegistry.current
    val r = requester ?: remember { FocusRequester() }
    androidx.compose.runtime.DisposableEffect(registry, key, r) {
        registry.requesters[key] = r
        registry.tracker.register(key)
        onDispose {
            if (registry.requesters[key] === r) {
                registry.requesters.remove(key)
                registry.tracker.unregister(key)
            }
        }
    }
    return this.focusRequester(r).onFocusChanged { if (it.isFocused) registry.tracker.last = key }
}
private enum class PlayarrCastDialogKind { Picker, Connected }

/**
 * Everything [PlayarrPlayerChrome] needs to render the cast entry point,
 * bundled into one parameter (rather than half a dozen more on an already
 * large signature) -- defaulted so this stays source-compatible with any
 * other call site. [visible] gates the whole button (see
 * `shouldOfferPlayarrCast`); the discovery/selection/stop callbacks are
 * plain lambdas so this file never needs to know about `PlayarrCastSession`
 * or Hilt.
 */
internal data class PlayarrPlayerCastState(
    val visible: Boolean = false,
    val connectionState: PlayarrCastConnectionState = PlayarrCastConnectionState.Unavailable,
    val error: String? = null,
    val onDismissError: () -> Unit = {},
    val routes: List<PlayarrCastRoute> = emptyList(),
    val onStartDiscovery: () -> Unit = {},
    val onStopDiscovery: () -> Unit = {},
    val onSelectRoute: (String) -> Unit = {},
    val onStopCasting: () -> Unit = {},
)

@Composable
internal fun PlayarrPlayerChrome(
    playbackState: PlaybackState,
    timeline: PlayarrPlayerTimeline,
    controls: PlayarrPlaybackControls,
    isTelevision: Boolean,
    queue: PlayarrPlaybackQueue,
    serverUrl: String,
    accessToken: String?,
    canPrevious: Boolean,
    canNext: Boolean,
    onPrevious: () -> Unit,
    onNext: () -> Unit,
    onSelectQueueItem: (Int) -> Unit,
    onBack: () -> Unit,
    onMinimise: (() -> Unit)?,
    onTogglePlayback: () -> Unit,
    onSeek: (Long) -> Unit,
    onQuality: (String) -> Unit,
    onAudio: (String) -> Unit,
    onSubtitle: (String?) -> Unit,
    cast: PlayarrPlayerCastState = PlayarrPlayerCastState(),
    onPlayOnDevice: (() -> Unit)? = null,
    health: PlayarrPlayerHealth? = null,
    notice: PlayarrString? = null,
    modifier: Modifier = Modifier,
) {
    var visible by remember { mutableStateOf(true) }
    val latestTimeline = androidx.compose.runtime.rememberUpdatedState(timeline)
    var activityEpoch by remember { mutableLongStateOf(0L) }
    var openMenu by remember { mutableStateOf<PlayarrPlayerMenu?>(null) }
    var playlistOpen by remember { mutableStateOf(false) }
    var castDialog by remember { mutableStateOf<PlayarrCastDialogKind?>(null) }
    var healthOpen by remember { mutableStateOf(false) }
    var scrubPositionMs by remember { mutableStateOf<Long?>(null) }
    var pendingSeekMs by remember { mutableStateOf<Long?>(null) }
    LaunchedEffect(pendingSeekMs) {
        val target = pendingSeekMs ?: return@LaunchedEffect
        delay(PLAYER_SEEK_COALESCE_MS)
        onSeek(target)
        pendingSeekMs = null
    }
    // On television the first show puts focus on play/pause (or the last focused control later).
    var pendingFocusTarget by remember { mutableStateOf<PlayarrPlayerFocusTarget?>(if (isTelevision) PlayarrPlayerFocusTarget.Restore else null) }
    val focusRegistry = remember { PlayerFocusRegistry() }
    // Returning from the background (HOME) shows the controls again with focus restored.
    androidx.lifecycle.compose.LifecycleEventEffect(androidx.lifecycle.Lifecycle.Event.ON_RESUME) {
        visible = true
        activityEpoch += 1L
        if (isTelevision) pendingFocusTarget = PlayarrPlayerFocusTarget.Restore
    }
    val surfaceFocusRequester = remember { FocusRequester() }
    val backFocusRequester = remember { FocusRequester() }
    val seekFocusRequester = remember { FocusRequester() }
    val interactionSource = remember { MutableInteractionSource() }
    val playlistFocusRequester = remember { FocusRequester() }
    val qualityFocusRequester = remember { FocusRequester() }

    fun showControls() {
        visible = true
        activityEpoch += 1L
    }

    LaunchedEffect(visible, playbackState.playWhenReady, activityEpoch, openMenu, playlistOpen, scrubPositionMs, healthOpen) {
        if (!visible || !playbackState.playWhenReady || openMenu != null || playlistOpen || scrubPositionMs != null || healthOpen) return@LaunchedEffect
        delay(PLAYER_CONTROLS_TIMEOUT_MS)
        visible = false
        surfaceFocusRequester.requestFocus()
    }

    LaunchedEffect(Unit) { surfaceFocusRequester.requestFocus() }

    // Coming back from the background: the title is paused and the controls are up.
    androidx.lifecycle.compose.LifecycleEventEffect(androidx.lifecycle.Lifecycle.Event.ON_RESUME) { showControls() }

    // BACK: an open panel closes first and focus returns to its opener, then the controls overlay, then the
    // next BACK exits (the host's BackHandler). Dialog-based panels (options, health, cast) consume BACK themselves.
    val qualityPopoverOpen = isTelevision && openMenu == PlayarrPlayerMenu.Quality
    val backAction = playarrPlayerBackAction(playlistOpen, qualityPopoverOpen || (!isTelevision && openMenu != null), visible)
    BackHandler(enabled = backAction != PlayarrPlayerBackAction.Exit) {
        when (backAction) {
            PlayarrPlayerBackAction.ClosePlaylist -> {
                playlistOpen = false
                showControls()
                pendingFocusTarget = PlayarrPlayerFocusTarget.Playlist
            }
            PlayarrPlayerBackAction.CloseMenu -> {
                openMenu = null
                showControls()
                pendingFocusTarget = if (isTelevision) PlayarrPlayerFocusTarget.Quality else null
            }
            PlayarrPlayerBackAction.HideControls -> {
                visible = false
                surfaceFocusRequester.requestFocus()
            }
            PlayarrPlayerBackAction.Exit -> Unit
        }
    }
    LaunchedEffect(visible, pendingFocusTarget) {
        val target = pendingFocusTarget ?: return@LaunchedEffect
        if (!visible) return@LaunchedEffect
        withFrameNanos { }
        when (target) {
            PlayarrPlayerFocusTarget.Back -> backFocusRequester.requestFocus()
            PlayarrPlayerFocusTarget.Seek -> seekFocusRequester.requestFocus()
            PlayarrPlayerFocusTarget.Playlist -> runCatching { playlistFocusRequester.requestFocus() }
            PlayarrPlayerFocusTarget.Quality -> runCatching { qualityFocusRequester.requestFocus() }
            PlayarrPlayerFocusTarget.Play -> runCatching { focusRegistry.requesters[PLAYER_FOCUS_PLAY]?.requestFocus() }
            PlayarrPlayerFocusTarget.Restore -> runCatching {
                (focusRegistry.requesters[focusRegistry.tracker.restoreKey()] ?: focusRegistry.requesters[PLAYER_FOCUS_PLAY])
                    ?.requestFocus()
            }
        }
        pendingFocusTarget = null
    }

    androidx.compose.runtime.CompositionLocalProvider(LocalPlayerFocusRegistry provides focusRegistry) {
    Box(modifier.fillMaxSize()) {
        Box(
            Modifier
                .fillMaxSize()
                .focusRequester(surfaceFocusRequester)
                .focusable()
                .onKeyEvent { event ->
                    if (event.type != KeyEventType.KeyDown) return@onKeyEvent false
                    when (playarrPlayerSurfaceAction(event.nativeKeyEvent.keyCode)) {
                        PlayarrPlayerSurfaceAction.TogglePlayback -> {
                            val wasVisible = visible
                            showControls()
                            if (playarrSurfaceSelectTogglesPlayback(wasVisible)) onTogglePlayback()
                            else pendingFocusTarget = PlayarrPlayerFocusTarget.Restore
                            true
                        }
                        // D-pad arrows never seek from the surface: they reveal hidden controls (focus on the
                        // last control) and nothing else. Only dedicated media keys and the scrubber seek.
                        PlayarrPlayerSurfaceAction.Reveal -> {
                            showControls()
                            pendingFocusTarget = PlayarrPlayerFocusTarget.Restore
                            true
                        }
                        PlayarrPlayerSurfaceAction.FocusBack -> {
                            val wasVisible = visible
                            showControls()
                            pendingFocusTarget = if (wasVisible) PlayarrPlayerFocusTarget.Back else PlayarrPlayerFocusTarget.Restore
                            true
                        }
                        PlayarrPlayerSurfaceAction.FocusSeek -> {
                            val wasVisible = visible
                            showControls()
                            pendingFocusTarget = if (wasVisible) PlayarrPlayerFocusTarget.Seek else PlayarrPlayerFocusTarget.Restore
                            true
                        }
                        null -> false
                    }
                }
                .then(
                    if (isTelevision) {
                        Modifier.clickable(
                            interactionSource = interactionSource,
                            indication = null,
                        ) {
                            val wasVisible = visible
                            showControls()
                            if (playarrSurfaceSelectTogglesPlayback(wasVisible)) onTogglePlayback()
                        }
                    } else {
                        // Phone: a tap reveals hidden controls (and toggles only when they were up); a double
                        // tap on the left or right half seeks 10 s back or forward.
                        // Keyed on the controls state only and reading the timeline through state: the position ticks many
                        // times a second and restarting the detector would drop the second tap.
                        Modifier.pointerInput(visible) {
                            detectTapGestures(
                                onTap = {
                                    val wasVisible = visible
                                    showControls()
                                    if (playarrSurfaceSelectTogglesPlayback(wasVisible)) onTogglePlayback()
                                },
                                onDoubleTap = { offset ->
                                    showControls()
                                    val delta = playarrDoubleTapSeekDeltaMs(offset.x, size.width.toFloat())
                                    onSeek(
                                        coalescedSeekTarget(latestTimeline.value.positionMs, null, delta, latestTimeline.value.durationMs),
                                    )
                                },
                            )
                        }
                    },
                ),
        )

        notice?.let { key ->
            Text(
                playarrString(key),
                color = Color.White,
                fontSize = 13.sp,
                modifier = Modifier
                    .align(Alignment.TopCenter)
                    .windowInsetsPadding(WindowInsets.safeDrawing)
                    .padding(top = 72.dp, start = 24.dp, end = 24.dp)
                    .background(Color.Black.copy(alpha = 0.72f), RoundedCornerShape(10.dp))
                    .padding(horizontal = 14.dp, vertical = 8.dp),
            )
        }

        if (!isTelevision) {
            PhonePlayerOverlay(
                visible = visible,
                playbackState = playbackState,
                timeline = timeline,
                controls = controls,
                canPrevious = canPrevious,
                canNext = canNext,
                scrubPositionMs = scrubPositionMs ?: pendingSeekMs,
                onScrub = { scrubPositionMs = it; showControls() },
                onScrubFinished = {
                    scrubPositionMs?.let(onSeek)
                    scrubPositionMs = null
                    showControls()
                },
                onTogglePlayback = { showControls(); onTogglePlayback() },
                onPrevious = { showControls(); onPrevious() },
                onNext = { showControls(); onNext() },
                openMenu = openMenu,
                onMenu = { openMenu = it; showControls() },
                onQuality = { onQuality(it); openMenu = null; showControls() },
                onAudio = { onAudio(it); openMenu = null; showControls() },
                onSubtitle = { onSubtitle(it); openMenu = null; showControls() },
                onTogglePlaylist = { playlistOpen = !playlistOpen; showControls() },
                onMinimise = onMinimise,
                onBack = onBack,
                onHealth = if (health != null) ({ showControls(); healthOpen = true }) else null,
                onPlayOnDevice = onPlayOnDevice,
                onCast = if (cast.visible) ({
                    showControls()
                    if (cast.connectionState is PlayarrCastConnectionState.Connected) {
                        castDialog = PlayarrCastDialogKind.Connected
                    } else {
                        cast.onStartDiscovery()
                        castDialog = PlayarrCastDialogKind.Picker
                    }
                }) else null,
                castConnected = cast.connectionState is PlayarrCastConnectionState.Connected,
                onActivity = { showControls() },
            )
        } else {
        AnimatedVisibility(visible = visible && !isTelevision, enter = PlayerChromeFadeEnter, exit = PlayerChromeFadeExit, modifier = Modifier.align(Alignment.TopStart)) {
            Row(
                modifier = Modifier.windowInsetsPadding(WindowInsets.safeDrawing).padding(16.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                if (onPlayOnDevice != null) {
                    PlayarrPlayerTopButton(
                        icon = Icons.Outlined.Devices,
                        label = playarrString(PlayarrString.RemotePlayOnButton),
                        accessibilityLabel = playarrString(PlayarrString.RemotePlayOnTitle),
                        isTelevision = isTelevision,
                        onClick = { showControls(); onPlayOnDevice() },
                    )
                }
                if (health != null) {
                    PlayarrPlayerTopButton(
                        icon = Icons.Outlined.Info,
                        label = playarrString(PlayarrString.HealthOpen),
                        accessibilityLabel = playarrString(PlayarrString.HealthOpen),
                        isTelevision = isTelevision,
                        onClick = { showControls(); healthOpen = true },
                    )
                }
                if (cast.visible) {
                    val connected = cast.connectionState is PlayarrCastConnectionState.Connected
                    val connecting = cast.connectionState is PlayarrCastConnectionState.Connecting
                    PlayarrPlayerTopButton(
                        icon = if (connected || connecting) Icons.Outlined.CastConnected else Icons.Outlined.Cast,
                        label = playarrString(PlayarrString.CastButtonLabel),
                        accessibilityLabel = (cast.connectionState as? PlayarrCastConnectionState.Connected)
                            ?.let { state ->
                                playarrString(
                                    PlayarrString.CastButtonConnectedLabel,
                                    "device" to (state.deviceName ?: playarrString(PlayarrString.CastButtonLabel)),
                                )
                            }
                            ?: playarrString(PlayarrString.CastButtonLabel),
                        isTelevision = isTelevision,
                        onClick = {
                            showControls()
                            if (connected) {
                                castDialog = PlayarrCastDialogKind.Connected
                            } else {
                                cast.onStartDiscovery()
                                castDialog = PlayarrCastDialogKind.Picker
                            }
                        },
                    )
                }
            }
        }

        AnimatedVisibility(visible = visible, enter = PlayerChromeFadeEnter, exit = PlayerChromeFadeExit, modifier = Modifier.align(Alignment.TopEnd)) {
            Row(
                modifier = (if (isTelevision) Modifier.padding(top = 37.8.dp, end = 58.dp) else Modifier.windowInsetsPadding(WindowInsets.safeDrawing).padding(16.dp)),
                horizontalArrangement = Arrangement.spacedBy(if (isTelevision) 12.dp else 8.dp),
            ) {
                if (onMinimise != null) {
                    PlayarrPlayerTopButton(
                        icon = if (isTelevision) WebIcons.Minimise else Icons.Outlined.PictureInPictureAlt,
                        label = playarrString(PlayarrString.PlayerMinimiseLabel),
                        accessibilityLabel = playarrString(PlayarrString.PlayerMinimise),
                        isTelevision = isTelevision,
                        onClick = { showControls(); onMinimise() },
                        modifier = Modifier.playerTracked("minimise"),
                    )
                }
                PlayarrPlayerTopButton(
                    icon = if (isTelevision) WebIcons.Close else Icons.Outlined.Close,
                    label = playarrString(PlayarrString.PlayerCloseLabel),
                    accessibilityLabel = playarrString(PlayarrString.PlayerClosePlayer),
                    isTelevision = isTelevision,
                    onClick = { onBack() },
                    iconOnly = isTelevision,
                    modifier = Modifier.playerTracked("close", backFocusRequester),
                )
            }
        }

        PlayarrPlayerScrim(visible = visible)
        AnimatedVisibility(visible = visible, enter = PlayerChromeFadeEnter, exit = PlayerChromeFadeExit, modifier = Modifier.align(Alignment.BottomCenter)) {
            PlayarrPlayerControlBar(
                playbackState = playbackState,
                timeline = timeline,
                controls = controls,
                isTelevision = isTelevision,
                queue = queue,
                seekFocusRequester = seekFocusRequester,
                playlistFocusRequester = playlistFocusRequester,
                qualityFocusRequester = qualityFocusRequester,
                canPrevious = canPrevious,
                canNext = canNext,
                scrubPositionMs = scrubPositionMs ?: pendingSeekMs,
                seekTargetMs = pendingSeekMs,
                onSeekStep = { direction, repeatCount ->
                    showControls()
                    val step = playarrSeekStepMs(repeatCount)
                    if (step > 0L) {
                        pendingSeekMs = coalescedSeekTarget(timeline.positionMs, pendingSeekMs, direction * step, timeline.durationMs)
                    }
                },
                onScrubberUp = { pendingFocusTarget = PlayarrPlayerFocusTarget.Back },
                onScrubberDown = { pendingFocusTarget = PlayarrPlayerFocusTarget.Play },
                onScrub = { scrubPositionMs = it; showControls() },
                onScrubFinished = {
                    scrubPositionMs?.let(onSeek)
                    scrubPositionMs = null
                    showControls()
                },
                onTogglePlayback = { showControls(); onTogglePlayback() },
                onPrevious = { showControls(); onPrevious() },
                onNext = { showControls(); onNext() },
                onMenu = { openMenu = it; showControls() },
                qualityMenuOpen = openMenu == PlayarrPlayerMenu.Quality,
                playlistOpen = playlistOpen,
                onTogglePlaylist = { playlistOpen = !playlistOpen; showControls() },
                trailing = {
                    // Web order after Quality: cast, playback health, play on another device.
                    if (cast.visible) {
                        val connected = cast.connectionState is PlayarrCastConnectionState.Connected
                        val connecting = cast.connectionState is PlayarrCastConnectionState.Connecting
                        PlayerRoundButton(
                            icon = if (connected || connecting) Icons.Outlined.CastConnected else Icons.Outlined.Cast,
                            contentDescription = playarrString(PlayarrString.CastButtonLabel),
                            focusKey = "cast",
                            onClick = {
                                showControls()
                                if (connected) {
                                    castDialog = PlayarrCastDialogKind.Connected
                                } else {
                                    cast.onStartDiscovery()
                                    castDialog = PlayarrCastDialogKind.Picker
                                }
                            },
                        )
                    }
                    if (health != null) {
                        PlayerRoundButton(
                            icon = WebIcons.Health,
                            contentDescription = playarrString(PlayarrString.HealthOpen),
                            focusKey = "health",
                            onClick = { showControls(); healthOpen = true },
                        )
                    }
                    if (onPlayOnDevice != null) {
                        PlayerRoundButton(
                            icon = WebIcons.PlayOnDevice,
                            contentDescription = playarrString(PlayarrString.RemotePlayOnTitle),
                            focusKey = "playon",
                            onClick = { showControls(); onPlayOnDevice() },
                        )
                    }
                },
            )
        }

        }

        AnimatedVisibility(visible = playlistOpen, modifier = Modifier.align(Alignment.CenterEnd)) {
            PlayarrPlayerPlaylistPanel(
                queue = queue,
                serverUrl = serverUrl,
                accessToken = accessToken,
                isTelevision = isTelevision,
                onClose = { playlistOpen = false; showControls() },
                onSelect = { index ->
                    if (index != queue.currentIndex) onSelectQueueItem(index)
                    playlistOpen = false
                    showControls()
                },
            )
        }

        if (isTelevision && openMenu == PlayarrPlayerMenu.Quality) {
            PlayarrQualityPopover(
                controls = controls,
                onSelect = { onQuality(it); openMenu = null; showControls() },
                modifier = Modifier.align(Alignment.TopStart).offset(x = 1074.8.dp, y = 540.dp),
            )
        }

        if (controls.switching || playbackState.isBuffering) {
            CircularProgressIndicator(
                color = Color.White,
                modifier = Modifier.align(Alignment.Center).size(38.dp),
            )
        }
    }
    }

    openMenu?.takeIf { isTelevision && it != PlayarrPlayerMenu.Quality }?.let { menu ->
        PlayarrPlayerOptionsDialog(
            menu = menu,
            controls = controls,
            onDismiss = { openMenu = null; showControls() },
            onQuality = { onQuality(it); openMenu = null; showControls() },
            onAudio = { onAudio(it); openMenu = null; showControls() },
            onSubtitle = { onSubtitle(it); openMenu = null; showControls() },
        )
    }

    if (healthOpen && health != null) {
        PlayarrPlaybackHealthDialog(
            health = health,
            isTelevision = isTelevision,
            onDismiss = { healthOpen = false; showControls() },
        )
    }

    LaunchedEffect(cast.error) {
        if (cast.error != null) castDialog = PlayarrCastDialogKind.Connected
    }

    castDialog?.let { kind ->
        PlayarrCastDialog(
            kind = kind,
            cast = cast,
            onDismiss = {
                if (kind == PlayarrCastDialogKind.Picker) cast.onStopDiscovery()
                cast.onDismissError()
                castDialog = null
                showControls()
            },
        )
    }
}

/**
 * A plain Material3 `PlayarrPanel` device picker/connected-session menu --
 * this app's theme is not AppCompat, so the stock
 * `MediaRouteChooserDialog`/`MediaRouteControllerDialog` cannot be used
 * here (see `PlayarrCastSession`'s KDoc).
 */
@Composable
private fun PlayarrCastDialog(
    kind: PlayarrCastDialogKind,
    cast: PlayarrPlayerCastState,
    onDismiss: () -> Unit,
) {
    PlayarrPanel(
        onDismissRequest = onDismiss,
        title = { Text(playarrString(PlayarrString.CastPickerTitle)) },
        text = {
            when (kind) {
                PlayarrCastDialogKind.Connected -> Text(
                    cast.error ?: playarrString(
                        PlayarrString.CastButtonConnectedLabel,
                        "device" to (
                            (cast.connectionState as? PlayarrCastConnectionState.Connected)?.deviceName
                                ?: playarrString(PlayarrString.CastButtonLabel)
                            ),
                    ),
                )
                PlayarrCastDialogKind.Picker -> if (cast.routes.isEmpty()) {
                    Text(playarrString(PlayarrString.CastPickerSearching))
                } else {
                    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        cast.routes.forEach { route ->
                            PlayerDialogOption(label = route.name, detail = null, selected = false) {
                                cast.onSelectRoute(route.id)
                                onDismiss()
                            }
                        }
                    }
                }
            }
        },
        confirmButton = {
            if (kind == PlayarrCastDialogKind.Connected) {
                PlayarrButton(onClick = { cast.onStopCasting(); onDismiss() }) {
                    Text(playarrString(PlayarrString.CastStopCasting))
                }
            }
        },
        dismissButton = {
            PlayarrButton(onClick = onDismiss, variant = PlayarrButtonVariant.Ghost) { Text(playarrString(PlayarrString.CommonClose)) }
        },
    )
}

/** The player's X (top right) while the session is still being negotiated, before the full chrome has content. */
@Composable
internal fun BoxScope.PlayarrPlayerLoadingClose(isTelevision: Boolean, onClose: () -> Unit) {
    Row(
        modifier = Modifier
            .align(Alignment.TopEnd)
            .then(
                if (isTelevision) Modifier.padding(top = 37.8.dp, end = 58.dp)
                else Modifier.windowInsetsPadding(WindowInsets.safeDrawing).padding(16.dp),
            ),
    ) {
        PlayarrPlayerTopButton(
            icon = if (isTelevision) WebIcons.Close else Icons.Outlined.Close,
            label = playarrString(PlayarrString.PlayerCloseLabel),
            accessibilityLabel = playarrString(PlayarrString.PlayerClosePlayer),
            isTelevision = isTelevision,
            onClick = onClose,
            iconOnly = isTelevision,
        )
    }
}

@Composable
private fun PlayarrPlayerTopButton(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    label: String,
    accessibilityLabel: String,
    isTelevision: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    iconOnly: Boolean = false,
) {
    // Web `.player-minimise` / `.player-close`: 48 high, rgba(12,10,11,.58) fill, 1px rgba(255,255,255,.28) ring.
    val source = remember { MutableInteractionSource() }
    Surface(
        onClick = onClick,
        interactionSource = source,
        color = if (isTelevision) Color(0x940C0A0B) else Color.Black.copy(alpha = 0.62f),
        contentColor = Color.White,
        shape = CircleShape,
        border = androidx.compose.foundation.BorderStroke(1.dp, Color.White.copy(alpha = 0.28f)),
        modifier = modifier.then(if (isTelevision) Modifier.shadow(14.dp, CircleShape, clip = false, ambientColor = Color.Black.copy(alpha = 0.3f), spotColor = Color.Black.copy(alpha = 0.3f)).playerFocusRing(source, CircleShape) else Modifier).then(
            if (isTelevision) {
                if (iconOnly) Modifier.size(48.dp) else Modifier.height(48.dp)
            } else {
                Modifier.size(44.dp)
            },
        ),
    ) {
        Row(
            modifier = if (isTelevision && iconOnly) Modifier.fillMaxSize() else Modifier.padding(horizontal = if (isTelevision) 22.dp else 11.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = if (isTelevision && iconOnly) Arrangement.Center else Arrangement.spacedBy(if (isTelevision) 8.8.dp else 8.dp),
        ) {
            Icon(icon, contentDescription = accessibilityLabel, modifier = Modifier.size(if (isTelevision && iconOnly) 11.dp else if (isTelevision) 20.dp else 22.dp))
            if (isTelevision && !iconOnly) {
                Text(label, fontSize = 12.sp, fontWeight = FontWeight.Bold, fontFamily = androidx.compose.ui.text.font.FontFamily.SansSerif)
            }
        }
    }
}

/** Web `.player-btn`: a 64 dp round control with an optional filled disc (the play button). */
@Composable
private fun PlayerRoundButton(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    contentDescription: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    disc: Boolean = false,
    tint: Color = Color.White,
    focusKey: String? = null,
) {
    val source = remember { MutableInteractionSource() }
    Surface(
        onClick = onClick,
        enabled = enabled,
        interactionSource = source,
        color = if (disc) Color.White.copy(alpha = 0.14f) else Color.Transparent,
        contentColor = tint,
        shape = CircleShape,
        modifier = modifier
            .then(if (focusKey != null) Modifier.playerTracked(focusKey) else Modifier)
            .size(64.dp)
            .playerFocusRing(source, CircleShape)
            .semantics { this.contentDescription = contentDescription },
    ) {
        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            Icon(icon, contentDescription = null, tint = tint, modifier = Modifier.size(20.dp))
        }
    }
}

@Composable
private fun PlayarrPlayerControlBar(
    qualityMenuOpen: Boolean = false,
    playbackState: PlaybackState,
    timeline: PlayarrPlayerTimeline,
    controls: PlayarrPlaybackControls,
    isTelevision: Boolean,
    queue: PlayarrPlaybackQueue,
    seekFocusRequester: FocusRequester,
    playlistFocusRequester: FocusRequester = FocusRequester(),
    qualityFocusRequester: FocusRequester = FocusRequester(),
    canPrevious: Boolean,
    canNext: Boolean,
    scrubPositionMs: Long?,
    seekTargetMs: Long? = null,
    onSeekStep: (Int, Int) -> Unit = { _, _ -> },
    onScrubberUp: () -> Unit = {},
    onScrubberDown: () -> Unit = {},
    onScrub: (Long) -> Unit,
    onScrubFinished: () -> Unit,
    onTogglePlayback: () -> Unit,
    onPrevious: () -> Unit,
    onNext: () -> Unit,
    onMenu: (PlayarrPlayerMenu) -> Unit,
    playlistOpen: Boolean,
    onTogglePlaylist: () -> Unit,
    trailing: @Composable () -> Unit = {},
) {
    val durationMs = timeline.durationMs.coerceAtLeast(0L)
    val displayedPositionMs = (scrubPositionMs ?: timeline.positionMs).coerceIn(0L, durationMs.coerceAtLeast(0L))
    val bufferedProgress = if (durationMs > 0L) {
        timeline.bufferedPositionMs.toFloat() / durationMs.toFloat()
    } else {
        0f
    }
    val seekDescription = playarrString(
        PlayarrString.PlayerSeekValueText,
        "position" to formatPlayarrPlayerTime(displayedPositionMs),
        "duration" to formatPlayarrPlayerTime(durationMs),
    )
    val focusManager = LocalFocusManager.current
    if (isTelevision) {
        PlayarrTelevisionControlBar(
            qualityMenuOpen = qualityMenuOpen,
            playbackState = playbackState,
            controls = controls,
            displayedPositionMs = displayedPositionMs,
            durationMs = durationMs,
            bufferedProgress = bufferedProgress,
            seekDescription = seekDescription,
            seekFocusRequester = seekFocusRequester,
            playlistFocusRequester = playlistFocusRequester,
            qualityFocusRequester = qualityFocusRequester,
            canPrevious = canPrevious,
            canNext = canNext,
            queue = queue,
            playlistOpen = playlistOpen,
            seekTargetMs = seekTargetMs,
            onSeekStep = onSeekStep,
            onScrubberUp = onScrubberUp,
            onScrubberDown = onScrubberDown,
            onScrub = onScrub,
            onScrubFinished = onScrubFinished,
            onTogglePlayback = onTogglePlayback,
            onPrevious = onPrevious,
            onNext = onNext,
            onMenu = onMenu,
            onTogglePlaylist = onTogglePlaylist,
            trailing = trailing,
        )
        return
    }
    Column(
        Modifier
            .fillMaxWidth()
            .background(
                Brush.verticalGradient(
                    listOf(Color.Transparent, Color.Black.copy(alpha = 0.92f)),
                ),
            )
            .windowInsetsPadding(WindowInsets.safeDrawing)
            .padding(horizontal = if (isTelevision) 48.dp else 18.dp, vertical = 18.dp),
    ) {
        queue.currentItem?.let { item ->
            Text(
                item.displayTitle(LocalPlayarrLanguage.current),
                color = Color.White,
                fontSize = if (isTelevision) 19.sp else 15.sp,
                fontWeight = FontWeight.SemiBold,
                maxLines = 1,
            )
            item.subtitle?.let { subtitle ->
                Text(
                    subtitle,
                    color = Color.White.copy(alpha = 0.68f),
                    fontSize = if (isTelevision) 12.sp else 10.sp,
                    maxLines = 1,
                    modifier = Modifier.padding(bottom = 6.dp),
                )
            }
        }
        LinearProgressIndicator(
            progress = { bufferedProgress.coerceIn(0f, 1f) },
            modifier = Modifier.fillMaxWidth().height(2.dp),
            color = Color.White.copy(alpha = 0.5f),
            trackColor = Color.White.copy(alpha = 0.12f),
        )
        Slider(
            value = displayedPositionMs.toFloat(),
            onValueChange = { onScrub(it.toLong()) },
            onValueChangeFinished = onScrubFinished,
            valueRange = 0f..durationMs.coerceAtLeast(1L).toFloat(),
            enabled = durationMs > 0L && !controls.switching,
            modifier = Modifier
                .focusRequester(seekFocusRequester)
                // The Slider swallows vertical D-pad keys, which trapped focus on
                // the seek bar; hand them to normal focus traversal instead.
                .onPreviewKeyEvent { event ->
                    if (event.type != KeyEventType.KeyDown) return@onPreviewKeyEvent false
                    when (event.key) {
                        Key.DirectionDown -> focusManager.moveFocus(FocusDirection.Down)
                        Key.DirectionUp -> focusManager.moveFocus(FocusDirection.Up)
                        else -> false
                    }
                }
                .fillMaxWidth()
                .semantics { contentDescription = seekDescription },
        )
        if (!isTelevision) {
            Text(
                "${formatPlayarrPlayerTime(displayedPositionMs)} / ${formatPlayarrPlayerTime(durationMs)}",
                color = Color.White,
                fontSize = 12.sp,
                fontWeight = FontWeight.SemiBold,
                modifier = Modifier.align(Alignment.End),
            )
        }
        Row(
            Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(if (isTelevision) 10.dp else 2.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            val onPreviousSource = remember { MutableInteractionSource() }
            PlayarrIconButton(
                onClick = onPrevious,
                contentDescription = playarrString(PlayarrString.PlayerPreviousEpisode),
                enabled = canPrevious && !controls.switching,
                interactionSource = onPreviousSource,
                modifier = Modifier.playerFocusRing(onPreviousSource, CircleShape),
            ) {
                Icon(
                    Icons.Outlined.SkipPrevious,
                    contentDescription = null,
                    tint = if (canPrevious && !controls.switching) Color.White else Color.White.copy(alpha = 0.35f))
            }
            val onTogglePlaybackSource = remember { MutableInteractionSource() }
            PlayarrIconButton(
                onClick = onTogglePlayback,
                contentDescription = playarrString(
                        if (playbackState.playWhenReady) PlayarrString.PlayerPause else PlayarrString.PlayerPlay,
                    ),
                enabled = !controls.switching,
                interactionSource = onTogglePlaybackSource,
                modifier = Modifier.playerFocusRing(onTogglePlaybackSource, CircleShape),
            ) {
                Icon(
                    if (playbackState.playWhenReady) Icons.Outlined.Pause else Icons.Outlined.PlayArrow,
                    contentDescription = null,
                    tint = Color.White,
                    modifier = Modifier.size(if (isTelevision) 34.dp else 28.dp))
            }
            val onNextSource = remember { MutableInteractionSource() }
            PlayarrIconButton(
                onClick = onNext,
                contentDescription = playarrString(PlayarrString.PlayerNextEpisode),
                enabled = canNext && !controls.switching,
                interactionSource = onNextSource,
                modifier = Modifier.playerFocusRing(onNextSource, CircleShape),
            ) {
                Icon(
                    Icons.Outlined.SkipNext,
                    contentDescription = null,
                    tint = if (canNext && !controls.switching) Color.White else Color.White.copy(alpha = 0.35f))
            }
            if (isTelevision) {
                Text(
                    "${formatPlayarrPlayerTime(displayedPositionMs)} / ${formatPlayarrPlayerTime(durationMs)}",
                    color = Color.White,
                    fontSize = 15.sp,
                    fontWeight = FontWeight.SemiBold,
                )
            }
            Spacer(Modifier.weight(1f))
            PlayerMenuButton(
                icon = Icons.AutoMirrored.Outlined.QueueMusic,
                label = playarrString(
                    if (queue.items.size == 1) {
                        PlayarrString.PlayerPlaylistLabelSingular
                    } else {
                        PlayarrString.PlayerPlaylistLabelPlural
                    },
                    "count" to queue.items.size,
                ),
                accessibilityLabel = if (playlistOpen) {
                    playarrString(PlayarrString.PlayerClosePlaylist)
                } else {
                    null
                },
                isTelevision = isTelevision,
                enabled = !controls.switching,
            ) { onTogglePlaylist() }
            if (controls.audioTracks.isNotEmpty()) {
                PlayerMenuButton(
                    Icons.Outlined.MusicNote,
                    playarrString(PlayarrString.PlayerAudioHeading),
                    isTelevision,
                    !controls.switching,
                    playarrString(PlayarrString.PlayerAudioTrackMenuLabel),
                ) {
                    onMenu(PlayarrPlayerMenu.Audio)
                }
            }
            // Always offered (as on web): with no text tracks the menu says so instead of the
            // control silently disappearing.
            PlayerMenuButton(
                Icons.Outlined.Subtitles,
                playarrString(PlayarrString.PlayerSubtitlesHeading),
                isTelevision,
                !controls.switching,
                playarrString(PlayarrString.PlayerSubtitleTrackMenuLabel),
            ) {
                onMenu(PlayarrPlayerMenu.Subtitles)
            }
            if (controls.qualityOptions.isNotEmpty()) {
                PlayerMenuButton(
                    Icons.Outlined.HighQuality,
                    playarrString(PlayarrString.PlayerQualityHeading),
                    isTelevision,
                    !controls.switching,
                    playarrString(PlayarrString.PlayerQualityMenuLabel),
                ) {
                    onMenu(PlayarrPlayerMenu.Quality)
                }
            }
        }
    }
}

/**
 * Television control bar, laid out like web `.player-controls` at 1920 x 1080: 70 dp side gutters, a 6 dp seek
 * track (15 dp thumb) 16 dp above a row of 64 dp round controls, 13.6 dp apart, bottom edge 58 dp from the screen
 * edge. Volume, mute and fullscreen are absent exactly as on the web Android TV client (`systemVolumeOnly`).
 */
@OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)
@Composable
internal fun PlayarrTelevisionControlBar(
    qualityMenuOpen: Boolean = false,
    playbackState: PlaybackState,
    controls: PlayarrPlaybackControls,
    displayedPositionMs: Long,
    durationMs: Long,
    bufferedProgress: Float,
    seekDescription: String,
    seekFocusRequester: FocusRequester,
    playlistFocusRequester: FocusRequester = FocusRequester(),
    qualityFocusRequester: FocusRequester = FocusRequester(),
    canPrevious: Boolean,
    canNext: Boolean,
    queue: PlayarrPlaybackQueue,
    playlistOpen: Boolean,
    seekTargetMs: Long? = null,
    onSeekStep: (Int, Int) -> Unit = { _, _ -> },
    onScrubberUp: () -> Unit = {},
    onScrubberDown: () -> Unit = {},
    onScrub: (Long) -> Unit,
    onScrubFinished: () -> Unit,
    onTogglePlayback: () -> Unit,
    onPrevious: () -> Unit,
    onNext: () -> Unit,
    onMenu: (PlayarrPlayerMenu) -> Unit,
    onTogglePlaylist: () -> Unit,
    trailing: @Composable () -> Unit,
) {
    val focusManager = LocalFocusManager.current
    val progress = if (durationMs > 0L) (displayedPositionMs.toFloat() / durationMs.toFloat()).coerceIn(0f, 1f) else 0f
    val dimmed = Color.White.copy(alpha = 0.35f)
    Column(
        Modifier
            .fillMaxWidth()
            // The scrim behind the bar is drawn separately (PlayarrPlayerScrim) so it can rise from the bottom.
            .padding(start = 70.dp, end = 70.dp, bottom = 58.dp, top = 40.dp),
        verticalArrangement = Arrangement.Bottom,
    ) {
        val scrubSource = remember { MutableInteractionSource() }
        val scrubFocused by scrubSource.collectIsFocusedAsState()
        Box(Modifier.fillMaxWidth().height(15.dp), contentAlignment = Alignment.CenterStart) {
            Box(
                Modifier
                    .fillMaxWidth()
                    .height(6.dp)
                    // Web focus treatment: a 3 dp white ring around the track.
                    .then(
                        if (scrubFocused) {
                            Modifier.drawBehind {
                                val ring = 3.dp.toPx()
                                drawRoundRect(
                                    color = Color.White,
                                    topLeft = androidx.compose.ui.geometry.Offset(-ring / 2f, -ring / 2f),
                                    size = androidx.compose.ui.geometry.Size(size.width + ring, size.height + ring),
                                    cornerRadius = androidx.compose.ui.geometry.CornerRadius(ring + 1.5.dp.toPx()),
                                    style = androidx.compose.ui.graphics.drawscope.Stroke(width = ring),
                                )
                            }
                        } else {
                            Modifier
                        },
                    )
                    .background(Color.White.copy(alpha = 0.2f), RoundedCornerShape(3.dp)),
            )
            Box(Modifier.fillMaxWidth(bufferedProgress.coerceIn(0f, 1f)).height(6.dp).background(Color.White.copy(alpha = 0.34f), RoundedCornerShape(3.dp)))
            Box(Modifier.fillMaxWidth(progress).height(6.dp).background(WebKicker, RoundedCornerShape(3.dp)))
            if (scrubFocused) {
                // Enlarged, highlighted thumb (web: 24 px white disc with an accent ring) while the scrubber has focus.
                Box(Modifier.fillMaxWidth(progress).height(24.dp), contentAlignment = Alignment.CenterEnd) {
                    Box(
                        Modifier
                            .offset(x = 12.dp)
                            .size(24.dp)
                            .background(Color.White, CircleShape)
                            .border(3.dp, WebKicker, CircleShape),
                    )
                }
            }
            if (seekTargetMs != null) {
                // Target-time label above the thumb while a seek is pending.
                Box(Modifier.fillMaxWidth(progress).height(15.dp), contentAlignment = Alignment.CenterEnd) {
                    Text(
                        formatPlayarrPlayerTime(seekTargetMs),
                        color = Color.White,
                        fontSize = 12.sp,
                        fontWeight = FontWeight.Bold,
                        modifier = Modifier
                            .layout { measurable, constraints ->
                                val placeable = measurable.measure(androidx.compose.ui.unit.Constraints())
                                layout(0, 0) { placeable.place(-placeable.width / 2, -placeable.height - 22.dp.roundToPx()) }
                            }
                            .background(Color(0xE60C0A0B), RoundedCornerShape(8.dp))
                            .padding(horizontal = 10.dp, vertical = 4.dp),
                    )
                }
            }
            // The Slider stays for input and semantics (D-pad seek, scrub) but draws nothing of its own.
            androidx.compose.runtime.CompositionLocalProvider(
                androidx.compose.material3.LocalMinimumInteractiveComponentSize provides 0.dp,
            ) {
                Slider(
                    value = displayedPositionMs.toFloat(),
                    onValueChange = { onScrub(it.toLong()) },
                    onValueChangeFinished = onScrubFinished,
                    valueRange = 0f..durationMs.coerceAtLeast(1L).toFloat(),
                    // Stays enabled while a source switch is in flight: a disabled Slider drops focus, and
                    // re-enabling it never gives focus back, which threw focus off the scrubber after a seek.
                    enabled = durationMs > 0L,
                    interactionSource = scrubSource,
                    thumb = {},
                    track = {},
                    modifier = Modifier
                        .playerTracked("seek", seekFocusRequester)
                        .onPreviewKeyEvent { event ->
                            // SELECT toggles play/pause and nothing else.
                            if (playarrScrubberSelectKey(event.nativeKeyEvent.keyCode)) {
                                if (event.type == KeyEventType.KeyDown && event.nativeKeyEvent.repeatCount == 0) onTogglePlayback()
                                return@onPreviewKeyEvent true
                            }
                            if (event.type != KeyEventType.KeyDown) return@onPreviewKeyEvent false
                            when (event.key) {
                                // 10 s per press, accelerating while held (the Slider's own 1% step is bypassed).
                                Key.DirectionLeft -> { onSeekStep(-1, event.nativeKeyEvent.repeatCount); true }
                                Key.DirectionRight -> { onSeekStep(1, event.nativeKeyEvent.repeatCount); true }
                                // Deterministic neighbours, as on web: up to the close button, down to play/pause.
                                Key.DirectionDown -> { onScrubberDown(); true }
                                Key.DirectionUp -> { onScrubberUp(); true }
                                else -> false
                            }
                        }
                        .fillMaxWidth()
                        .height(15.dp)
                        .semantics { contentDescription = seekDescription },
                )
            }
        }
        Spacer(Modifier.height(11.5.dp))
        Row(
            Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(13.6.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            PlayerRoundButton(
                icon = WebIcons.Previous,
                contentDescription = playarrString(PlayarrString.PlayerPreviousEpisode),
                onClick = onPrevious,
                enabled = canPrevious && !controls.switching,
                tint = if (canPrevious && !controls.switching) Color.White else dimmed,
                focusKey = "prev",
            )
            PlayerRoundButton(
                icon = if (playbackState.playWhenReady) WebIcons.Pause else WebIcons.Play,
                contentDescription = playarrString(
                    if (playbackState.playWhenReady) PlayarrString.PlayerPause else PlayarrString.PlayerPlay,
                ),
                onClick = onTogglePlayback,
                enabled = !controls.switching,
                disc = true,
                focusKey = PLAYER_FOCUS_PLAY,
            )
            PlayerRoundButton(
                icon = WebIcons.Next,
                contentDescription = playarrString(PlayarrString.PlayerNextEpisode),
                onClick = onNext,
                enabled = canNext && !controls.switching,
                tint = if (canNext && !controls.switching) Color.White else dimmed,
                focusKey = "next",
            )
            Text(
                "${formatPlayarrPlayerTime(displayedPositionMs)} / ${formatPlayarrPlayerTime(durationMs)}",
                color = Color.White,
                fontSize = 10.88.sp,
            )
            Spacer(Modifier.weight(1f))
            if (controls.audioTracks.isNotEmpty()) {
                PlayerRoundButton(
                    icon = WebIcons.AudioTrack,
                    contentDescription = playarrString(PlayarrString.PlayerAudioTrackMenuLabel),
                    onClick = { onMenu(PlayarrPlayerMenu.Audio) },
                    enabled = !controls.switching,
                    focusKey = "audio",
                )
            }
            PlayerRoundButton(
                icon = WebIcons.Subtitles,
                contentDescription = playarrString(PlayarrString.PlayerSubtitleTrackMenuLabel),
                onClick = { onMenu(PlayarrPlayerMenu.Subtitles) },
                enabled = !controls.switching,
                focusKey = "subs",
            )
            PlayerRoundButton(
                icon = WebIcons.PlaylistQueue,
                contentDescription = if (playlistOpen) {
                    playarrString(PlayarrString.PlayerClosePlaylist)
                } else {
                    playarrString(
                        if (queue.items.size == 1) PlayarrString.PlayerPlaylistLabelSingular else PlayarrString.PlayerPlaylistLabelPlural,
                        "count" to queue.items.size,
                    )
                },
                onClick = onTogglePlaylist,
                enabled = !controls.switching,
                modifier = Modifier.playerTracked("playlist", playlistFocusRequester),
            )
            if (controls.qualityOptions.isNotEmpty()) {
                val active = controls.qualityOptions.firstOrNull { it.id == controls.activeQualityId }
                val source = remember { MutableInteractionSource() }
                val qualityDescription = playarrString(PlayarrString.PlayerQualityMenuLabel)
                Surface(
                    onClick = { onMenu(PlayarrPlayerMenu.Quality) },
                    enabled = !controls.switching,
                    interactionSource = source,
                    // Web `.player-quality-button.is-active`: a 14% white pill while its menu is open.
                    color = if (qualityMenuOpen) Color.White.copy(alpha = 0.14f) else Color.Transparent,
                    contentColor = Color.White,
                    shape = CircleShape,
                    modifier = Modifier
                        .height(56.dp)
                        .playerTracked("quality", qualityFocusRequester)
                        .playerFocusRing(source, CircleShape)
                        .semantics { contentDescription = qualityDescription },
                ) {
                    Row(
                        Modifier.padding(horizontal = 14.4.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(8.8.dp),
                    ) {
                        Text("HD", fontSize = 7.sp, fontWeight = FontWeight.ExtraBold)
                        Text(
                            active?.let { playarrQualityLabel(it.label, it.videoBitrateBps, it.id == "original") }
                                ?: playarrString(PlayarrString.PlayerQualityHeading),
                            fontSize = 10.56.sp,
                            fontWeight = FontWeight.Bold,
                            letterSpacing = 0.1056.sp,
                        )
                    }
                }
            }
            trailing()
        }
    }
}

@Composable
private fun PlayarrPlayerPlaylistPanel(
    queue: PlayarrPlaybackQueue,
    serverUrl: String,
    accessToken: String?,
    isTelevision: Boolean,
    onClose: () -> Unit,
    onSelect: (Int) -> Unit,
) {
    val closeDescription = playarrString(PlayarrString.PlayerClosePlaylist)
    Surface(
        color = Color(0xF21B181B),
        shape = RoundedCornerShape(topStart = 20.dp, bottomStart = 20.dp),
        modifier = Modifier
            .fillMaxHeight()
            .width(if (isTelevision) 430.dp else 330.dp)
            .windowInsetsPadding(WindowInsets.safeDrawing),
    ) {
        Column(Modifier.fillMaxSize().padding(vertical = 24.dp)) {
            Row(
                modifier = Modifier.fillMaxWidth().padding(horizontal = 22.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(Modifier.weight(1f)) {
                    Text(
                        playarrString(PlayarrString.PlayerUpNext).uppercase(LocalPlayarrLanguage.current.locale),
                        color = WebAccent,
                        fontSize = 10.sp,
                        fontWeight = FontWeight.ExtraBold,
                    )
                    Text(
                        playarrString(
                            PlayarrString.PlayerQueueCount,
                            "count" to queue.items.size,
                            "unit" to playarrString(playarrPlayerQueueUnit(queue.items.size, queue.currentItem?.music == true)),
                        ),
                        color = Color.White.copy(alpha = 0.66f),
                        fontSize = 12.sp,
                    )
                }
                PlayarrButton(
                    onClick = onClose,
                    modifier = Modifier.semantics { contentDescription = closeDescription },
                    variant = PlayarrButtonVariant.Ghost,
                ) {
                    Text("×", color = Color.White, fontSize = 24.sp)
                }
            }
            androidx.compose.foundation.lazy.LazyColumn(
                modifier = Modifier.fillMaxSize().padding(top = 16.dp),
                contentPadding = androidx.compose.foundation.layout.PaddingValues(bottom = 24.dp),
                verticalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                itemsIndexed(queue.items, key = { index, item -> "${item.mediaFileId}-$index" }) { index, item ->
                    val active = index == queue.currentIndex
                    val previousSeason = queue.items.getOrNull(index - 1)?.seasonNumber
                    if (item.seasonNumber != null && item.seasonNumber != previousSeason) {
                        Text(
                            playarrString(PlayarrString.PlayerSeasonHeading, "number" to item.seasonNumber),
                            color = Color.White.copy(alpha = 0.72f),
                            fontSize = 13.sp,
                            fontWeight = FontWeight.SemiBold,
                            modifier = Modifier.padding(start = 22.dp, top = 12.dp, bottom = 4.dp),
                        )
                    }
                    Surface(
                        onClick = { onSelect(index) },
                        color = if (active) WebSurfaceSoft else Color.Transparent,
                        shape = RoundedCornerShape(12.dp),
                        modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp),
                    ) {
                        Row(
                            modifier = Modifier.padding(10.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(12.dp),
                        ) {
                            item.artworkWork?.let { work ->
                                AuthenticatedArtwork(
                                    work = work,
                                    kinds = listOf(
                                        io.playarr.shared.data.model.ImageKind.Thumb,
                                        io.playarr.shared.data.model.ImageKind.Backdrop,
                                        io.playarr.shared.data.model.ImageKind.Poster,
                                    ),
                                    serverUrl = serverUrl,
                                    accessToken = accessToken,
                                    contentScale = ContentScale.Crop,
                                    modifier = Modifier.width(88.dp).height(50.dp),
                                )
                            } ?: Box(
                                modifier = Modifier.width(88.dp).height(50.dp).background(Color.White.copy(alpha = 0.08f)),
                                contentAlignment = Alignment.Center,
                            ) {
                                Text((index + 1).toString().padStart(2, '0'), color = Color.White.copy(alpha = 0.5f))
                            }
                            Column(Modifier.weight(1f)) {
                                Text(
                                    when {
                                        item.seasonNumber != null && item.episodeNumber != null ->
                                            playarrString(
                                                PlayarrString.PlayerSeasonEpisodeLabel,
                                                "season" to item.seasonNumber.toString().padStart(2, '0'),
                                                "episode" to item.episodeNumber.toString().padStart(2, '0'),
                                            )
                                        active -> playarrString(PlayarrString.PlayerNowPlaying)
                                        item.music -> playarrString(PlayarrString.PlayerTrackLabel)
                                        else -> playarrString(PlayarrString.PlayerMovieLabel)
                                    },
                                    color = if (active) WebAccent else Color.White.copy(alpha = 0.54f),
                                    fontSize = 9.sp,
                                    fontWeight = FontWeight.Bold,
                                )
                                Text(
                                    item.displayTitle(LocalPlayarrLanguage.current),
                                    color = Color.White,
                                    fontWeight = FontWeight.SemiBold,
                                    maxLines = 1,
                                )
                                item.subtitle?.let { subtitle ->
                                    Text(subtitle, color = Color.White.copy(alpha = 0.58f), fontSize = 10.sp, maxLines = 1)
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

/** Visible D-pad focus cue for the player's Material buttons, which show none on television. */
@Composable
private fun Modifier.playerFocusRing(source: MutableInteractionSource, shape: androidx.compose.ui.graphics.Shape): Modifier {
    val focused by source.collectIsFocusedAsState()
    return if (focused) border(2.dp, Color.White, shape) else this
}

@Composable
private fun PlayerMenuButton(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    label: String,
    isTelevision: Boolean,
    enabled: Boolean,
    accessibilityLabel: String? = null,
    onClick: () -> Unit,
) {
    if (isTelevision) {
        val source = remember { MutableInteractionSource() }
        PlayarrButton(
            onClick = onClick,
            enabled = enabled,
            interactionSource = source,
            modifier = Modifier.playerFocusRing(source, CircleShape),
            variant = PlayarrButtonVariant.Ghost,
        ) {
            Icon(icon, contentDescription = null, tint = Color.White, modifier = Modifier.size(22.dp))
            Text(label, color = Color.White, modifier = Modifier.padding(start = 6.dp))
        }
    } else {
        PlayarrIconButton(onClick = onClick, contentDescription = accessibilityLabel ?: label, enabled = enabled) {
            Icon(icon, contentDescription = null, tint = Color.White)
        }
    }
}

/**
 * Web `.player-quality-menu` (620 x 408 at x 1074.8, y 540): the Original choice over a Low / Medium / High matrix
 * of UHD, FHD, HD and SD, 156.6 x 60 cells on a 162.6 pitch, instead of a side panel.
 */
@Composable
private fun PlayarrQualityPopover(
    controls: PlayarrPlaybackControls,
    onSelect: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    val available = remember(controls.qualityOptions) { controls.qualityOptions.map { it.id }.toSet() }
    val original = controls.qualityOptions.firstOrNull { it.id == "original" }
    val selectedFocus = remember { FocusRequester() }
    LaunchedEffect(Unit) { runCatching { selectedFocus.requestFocus() } }
    Column(
        modifier
            .size(620.dp, 408.dp)
            .background(Color(0xE6120E11), RoundedCornerShape(18.dp))
            .border(1.dp, Color.White.copy(alpha = 0.18f), RoundedCornerShape(18.dp))
            .padding(9.8.dp),
    ) {
        Box(Modifier.fillMaxWidth().height(28.9.dp), contentAlignment = Alignment.CenterStart) {
            Text(
                playarrString(PlayarrString.PlayerQualityHeading).uppercase(LocalPlayarrLanguage.current.locale),
                color = Color.White.copy(alpha = 0.56f),
                fontSize = 8.64.sp,
                fontWeight = FontWeight(760),
                letterSpacing = 1.296.sp,
            )
        }
        if (original != null) {
            QualityChoice(
                label = playarrQualityLabel(original.label, original.videoBitrateBps, true),
                detail = playarrString(PlayarrString.PlayerQualitySource),
                selected = original.id == controls.activeQualityId,
                modifier = Modifier.fillMaxWidth().height(60.dp).focusRequester(selectedFocus),
                onClick = { onSelect(original.id) },
            )
        }
        // Web grid columns land on whole pixels as 157, 156 and 157 wide (starting 118 px in, 6 px gaps).
        val columnWidths = listOf(157f, 156f, 157f)
        Spacer(Modifier.height(7.dp))
        Row(Modifier.height(27.5.dp), verticalAlignment = Alignment.CenterVertically) {
            Spacer(Modifier.width(118.dp))
            listOf(PlayarrString.SettingsQualityLow, PlayarrString.SettingsQualityMedium, PlayarrString.SettingsQualityHigh).forEachIndexed { i, key ->
                Text(
                    playarrString(key).uppercase(LocalPlayarrLanguage.current.locale),
                    color = Color.White.copy(alpha = 0.54f),
                    fontSize = 10.24.sp,
                    fontWeight = FontWeight(760),
                    letterSpacing = 0.819.sp,
                    textAlign = androidx.compose.ui.text.style.TextAlign.Center,
                    modifier = Modifier.width(columnWidths[i].dp).padding(start = 0.dp),
                )
                if (i < 2) Spacer(Modifier.width(6.dp))
            }
        }
        playarrQualityTiers.forEach { tier ->
            Spacer(Modifier.height(6.dp))
            Row(Modifier.height(60.dp), verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.width(118.dp).padding(start = 4.dp).offset(y = (-1).dp), verticalArrangement = Arrangement.Center) {
                    Text(tier.label, color = Color.White, fontSize = 12.16.sp, fontWeight = FontWeight(760), lineHeight = 18.2.sp)
                    Text(tier.resolution, color = Color.White.copy(alpha = 0.54f), fontSize = 9.28.sp, lineHeight = 13.9.sp)
                }
                tier.options.forEachIndexed { i, option ->
                    if (option.id in available) {
                        QualityChoice(
                            label = playarrString(PlayarrString.SettingsQualityBitrate, "value" to option.bitrateMbps),
                            detail = playarrString(qualityLevelString(option.level)),
                            selected = option.id == controls.activeQualityId,
                            modifier = Modifier.width(columnWidths[i].dp).height(60.dp),
                            onClick = { onSelect(option.id) },
                        )
                    } else {
                        Box(Modifier.width(columnWidths[i].dp).height(60.dp), contentAlignment = Alignment.Center) {
                            Text("\u2014", color = Color.White.copy(alpha = 0.3f), fontSize = 12.sp)
                        }
                    }
                    if (i < 2) Spacer(Modifier.width(6.dp))
                }
            }
        }
    }
}

private fun qualityLevelString(level: String): PlayarrString = when (level.lowercase()) {
    "low" -> PlayarrString.SettingsQualityLow
    "medium" -> PlayarrString.SettingsQualityMedium
    else -> PlayarrString.SettingsQualityHigh
}

/** Web `.quality-matrix-choice`: a 10 dp card, white .055 fill and .1 ring, .15 and .24 plus a pink check when selected. */
@Composable
private fun QualityChoice(
    label: String,
    detail: String,
    selected: Boolean,
    modifier: Modifier,
    onClick: () -> Unit,
) {
    var focused by remember { mutableStateOf(false) }
    Surface(
        onClick = onClick,
        shape = RoundedCornerShape(10.dp),
        // Web: the selected choice is crimson (a faint crimson fill and a crimson ring), not white.
        color = if (selected) WebKicker.copy(alpha = 0.24f) else Color.White.copy(alpha = 0.055f),
        contentColor = Color.White,
        border = androidx.compose.foundation.BorderStroke(
            if (focused) 2.dp else 1.dp,
            if (focused) Color.White.copy(alpha = 0.9f) else if (selected) WebKicker.copy(alpha = 0.85f) else Color.White.copy(alpha = 0.1f),
        ),
        modifier = modifier.onFocusChanged { focused = it.isFocused },
    ) {
        Row(Modifier.padding(horizontal = 9.92.dp, vertical = 8.8.dp), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.Center) {
                Text(label, fontSize = 12.48.sp, fontWeight = FontWeight.Bold, lineHeight = 15.sp, maxLines = 1, modifier = Modifier.offset(y = (-3).dp))
                Text(detail, color = Color.White.copy(alpha = 0.54f), fontSize = 9.28.sp, lineHeight = 13.sp, maxLines = 1, modifier = Modifier.offset(y = (-1.5).dp))
            }
            if (selected) Text("\u2713", color = WebKicker, fontSize = 11.84.sp)
        }
    }
}

@Composable
private fun PlayarrPlayerOptionsDialog(
    menu: PlayarrPlayerMenu,
    controls: PlayarrPlaybackControls,
    onDismiss: () -> Unit,
    onQuality: (String) -> Unit,
    onAudio: (String) -> Unit,
    onSubtitle: (String?) -> Unit,
) {
    val locale = LocalPlayarrLanguage.current.locale
    PlayarrPanel(
        onDismissRequest = onDismiss,
        title = {
            Text(
                when (menu) {
                    PlayarrPlayerMenu.Quality -> playarrString(PlayarrString.PlayerQualityHeading)
                    PlayarrPlayerMenu.Audio -> playarrString(PlayarrString.PlayerAudioHeading)
                    PlayarrPlayerMenu.Subtitles -> playarrString(PlayarrString.PlayerSubtitlesHeading)
                },
            )
        },
        text = {
            androidx.compose.foundation.lazy.LazyColumn(
                modifier = Modifier.fillMaxWidth().heightIn(max = 360.dp),
                verticalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                if (menu == PlayarrPlayerMenu.Subtitles) {
                    item {
                        PlayerDialogOption(
                            label = playarrString(PlayarrString.PlayerOff),
                            detail = playarrString(
                                if (controls.subtitleTracks.isEmpty()) {
                                    PlayarrString.PlayerNoSubtitleTracksAvailable
                                } else {
                                    PlayarrString.PlayerNoSubtitles
                                },
                            ),
                            selected = controls.selectedSubtitleTrackId == null,
                        ) { onSubtitle(null) }
                    }
                }
                when (menu) {
                    PlayarrPlayerMenu.Quality -> items(controls.qualityOptions.size) { index ->
                        val option = controls.qualityOptions[index]
                        PlayerDialogOption(
                            label = playarrQualityLabel(option.label, option.videoBitrateBps, option.id == "original"),
                            detail = if (option.id == "original") null else playarrQualityBitrateDetail(option.videoBitrateBps),
                            selected = option.id == controls.activeQualityId,
                        ) { onQuality(option.id) }
                    }
                    PlayarrPlayerMenu.Audio -> items(controls.audioTracks.size) { index ->
                        val track = controls.audioTracks[index]
                        PlayerDialogOption(
                            label = playarrAudioTrackLabel(
                                track,
                                locale,
                                playarrString(PlayarrString.PlayerChannelsMono),
                                playarrString(PlayarrString.PlayerChannelsStereo),
                            ),
                            detail = null,
                            selected = track.id == (controls.selectedAudioTrackId ?: controls.audioTracks.firstOrNull()?.id),
                        ) { onAudio(track.id) }
                    }
                    PlayarrPlayerMenu.Subtitles -> items(controls.subtitleTracks.size) { index ->
                        val track = controls.subtitleTracks[index]
                        PlayerDialogOption(
                            label = playarrSubtitleTrackLabel(track, locale, playarrString(PlayarrString.PlayerSubtitleForced)),
                            detail = null,
                            selected = track.id == controls.selectedSubtitleTrackId,
                        ) { onSubtitle(track.id) }
                    }
                }
            }
        },
        confirmButton = {
            PlayarrButton(onClick = onDismiss) { Text(playarrString(PlayarrString.CommonClose)) }
        },
    )
}

internal fun playarrPlayerQueueUnit(itemCount: Int, music: Boolean): PlayarrString = when {
    music && itemCount == 1 -> PlayarrString.PlayerUnitTrack
    music -> PlayarrString.PlayerUnitTracks
    itemCount == 1 -> PlayarrString.PlayerUnitItem
    else -> PlayarrString.PlayerUnitEpisodes
}

@Composable
private fun PlayerDialogOption(
    label: String,
    detail: String?,
    selected: Boolean,
    onClick: () -> Unit,
) {
    PlayarrButton(onClick = onClick, modifier = Modifier.fillMaxWidth(), variant = PlayarrButtonVariant.Secondary) {
        Column(Modifier.weight(1f), horizontalAlignment = Alignment.Start) {
            Text(label)
            detail?.let { Text(it, color = WebInkMuted, fontSize = 11.sp) }
        }
        if (selected) Text("✓", color = WebAccent, fontWeight = FontWeight.Bold)
    }
}
