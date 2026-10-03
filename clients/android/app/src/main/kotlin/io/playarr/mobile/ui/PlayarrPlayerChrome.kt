package io.playarr.mobile.ui

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.focusable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
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
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.automirrored.outlined.QueueMusic
import androidx.compose.material.icons.outlined.Cast
import androidx.compose.material.icons.outlined.CastConnected
import androidx.compose.material.icons.outlined.HighQuality
import androidx.compose.material.icons.outlined.MusicNote
import androidx.compose.material.icons.outlined.Pause
import androidx.compose.material.icons.outlined.PictureInPictureAlt
import androidx.compose.material.icons.outlined.PlayArrow
import androidx.compose.material.icons.outlined.SkipNext
import androidx.compose.material.icons.outlined.SkipPrevious
import androidx.compose.material.icons.outlined.Subtitles
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Slider
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
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
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.playarr.mobile.cast.PlayarrCastConnectionState
import io.playarr.mobile.cast.PlayarrCastRoute
import io.playarr.shared.player.PlaybackState
import kotlinx.coroutines.delay

private const val PLAYER_CONTROLS_TIMEOUT_MS = 3_500L

private enum class PlayarrPlayerMenu { Quality, Audio, Subtitles }
private enum class PlayarrPlayerFocusTarget { Back, Seek }
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
    onMinimise: () -> Unit,
    onTogglePlayback: () -> Unit,
    onSeek: (Long) -> Unit,
    onQuality: (String) -> Unit,
    onAudio: (String) -> Unit,
    onSubtitle: (String?) -> Unit,
    cast: PlayarrPlayerCastState = PlayarrPlayerCastState(),
    modifier: Modifier = Modifier,
) {
    var visible by remember { mutableStateOf(true) }
    var activityEpoch by remember { mutableLongStateOf(0L) }
    var openMenu by remember { mutableStateOf<PlayarrPlayerMenu?>(null) }
    var playlistOpen by remember { mutableStateOf(false) }
    var castDialog by remember { mutableStateOf<PlayarrCastDialogKind?>(null) }
    var scrubPositionMs by remember { mutableStateOf<Long?>(null) }
    var pendingFocusTarget by remember { mutableStateOf<PlayarrPlayerFocusTarget?>(null) }
    val surfaceFocusRequester = remember { FocusRequester() }
    val backFocusRequester = remember { FocusRequester() }
    val seekFocusRequester = remember { FocusRequester() }
    val interactionSource = remember { MutableInteractionSource() }

    fun showControls() {
        visible = true
        activityEpoch += 1L
    }

    LaunchedEffect(visible, playbackState.playWhenReady, activityEpoch, openMenu, playlistOpen, scrubPositionMs) {
        if (!visible || !playbackState.playWhenReady || openMenu != null || playlistOpen || scrubPositionMs != null) return@LaunchedEffect
        delay(PLAYER_CONTROLS_TIMEOUT_MS)
        visible = false
        surfaceFocusRequester.requestFocus()
    }

    LaunchedEffect(Unit) { surfaceFocusRequester.requestFocus() }
    LaunchedEffect(visible, pendingFocusTarget) {
        val target = pendingFocusTarget ?: return@LaunchedEffect
        if (!visible) return@LaunchedEffect
        withFrameNanos { }
        when (target) {
            PlayarrPlayerFocusTarget.Back -> backFocusRequester.requestFocus()
            PlayarrPlayerFocusTarget.Seek -> seekFocusRequester.requestFocus()
        }
        pendingFocusTarget = null
    }

    Box(modifier.fillMaxSize()) {
        Box(
            Modifier
                .fillMaxSize()
                .focusRequester(surfaceFocusRequester)
                .focusable()
                .onKeyEvent { event ->
                    if (event.type != KeyEventType.KeyDown) return@onKeyEvent false
                    when (playarrPlayerSurfaceAction(event.key.keyCode.toInt())) {
                        PlayarrPlayerSurfaceAction.TogglePlayback -> {
                            showControls()
                            onTogglePlayback()
                            true
                        }
                        PlayarrPlayerSurfaceAction.SeekBackward -> {
                            showControls()
                            onSeek((timeline.positionMs - 5_000L).coerceAtLeast(0L))
                            true
                        }
                        PlayarrPlayerSurfaceAction.SeekForward -> {
                            showControls()
                            val target = timeline.positionMs + 5_000L
                            onSeek(if (timeline.durationMs > 0L) target.coerceAtMost(timeline.durationMs) else target)
                            true
                        }
                        PlayarrPlayerSurfaceAction.FocusBack -> {
                            showControls()
                            pendingFocusTarget = PlayarrPlayerFocusTarget.Back
                            true
                        }
                        PlayarrPlayerSurfaceAction.FocusSeek -> {
                            showControls()
                            pendingFocusTarget = PlayarrPlayerFocusTarget.Seek
                            true
                        }
                        null -> false
                    }
                }
                .clickable(
                    interactionSource = interactionSource,
                    indication = null,
                ) {
                    showControls()
                    onTogglePlayback()
                },
        )

        AnimatedVisibility(visible = visible, modifier = Modifier.align(Alignment.TopStart)) {
            Row(
                modifier = Modifier.windowInsetsPadding(WindowInsets.safeDrawing).padding(16.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                PlayarrPlayerTopButton(
                    icon = Icons.AutoMirrored.Outlined.ArrowBack,
                    label = playarrString(PlayarrString.CommonBack),
                    accessibilityLabel = playarrString(PlayarrString.PlayerBackToDetails),
                    isTelevision = isTelevision,
                    onClick = { showControls(); onBack() },
                    modifier = Modifier.focusRequester(backFocusRequester),
                )
                PlayarrPlayerTopButton(
                    icon = Icons.Outlined.PictureInPictureAlt,
                    label = playarrString(PlayarrString.PlayerMinimiseLabel),
                    accessibilityLabel = playarrString(PlayarrString.PlayerMinimise),
                    isTelevision = isTelevision,
                    onClick = { showControls(); onMinimise() },
                )
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

        AnimatedVisibility(visible = visible, modifier = Modifier.align(Alignment.BottomCenter)) {
            PlayarrPlayerControlBar(
                playbackState = playbackState,
                timeline = timeline,
                controls = controls,
                isTelevision = isTelevision,
                queue = queue,
                seekFocusRequester = seekFocusRequester,
                canPrevious = canPrevious,
                canNext = canNext,
                scrubPositionMs = scrubPositionMs,
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
                playlistOpen = playlistOpen,
                onTogglePlaylist = { playlistOpen = !playlistOpen; showControls() },
            )
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

        if (controls.switching || playbackState.isBuffering) {
            CircularProgressIndicator(
                color = Color.White,
                modifier = Modifier.align(Alignment.Center).size(38.dp),
            )
        }
    }

    openMenu?.let { menu ->
        PlayarrPlayerOptionsDialog(
            menu = menu,
            controls = controls,
            onDismiss = { openMenu = null; showControls() },
            onQuality = { onQuality(it); openMenu = null; showControls() },
            onAudio = { onAudio(it); openMenu = null; showControls() },
            onSubtitle = { onSubtitle(it); openMenu = null; showControls() },
        )
    }

    castDialog?.let { kind ->
        PlayarrCastDialog(
            kind = kind,
            cast = cast,
            onDismiss = {
                if (kind == PlayarrCastDialogKind.Picker) cast.onStopDiscovery()
                castDialog = null
                showControls()
            },
        )
    }
}

/**
 * A plain Material3 `AlertDialog` device picker/connected-session menu --
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
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(playarrString(PlayarrString.CastPickerTitle)) },
        text = {
            when (kind) {
                PlayarrCastDialogKind.Connected -> Text(
                    playarrString(
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
                TextButton(onClick = { cast.onStopCasting(); onDismiss() }) {
                    Text(playarrString(PlayarrString.CastStopCasting))
                }
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) { Text(playarrString(PlayarrString.CommonClose)) }
        },
    )
}

@Composable
private fun PlayarrPlayerTopButton(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    label: String,
    accessibilityLabel: String,
    isTelevision: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Surface(
        onClick = onClick,
        color = Color.Black.copy(alpha = 0.62f),
        contentColor = Color.White,
        shape = CircleShape,
        border = androidx.compose.foundation.BorderStroke(1.dp, Color.White.copy(alpha = 0.28f)),
        modifier = modifier.then(if (isTelevision) Modifier.height(48.dp) else Modifier.size(44.dp)),
    ) {
        Row(
            modifier = Modifier.padding(horizontal = if (isTelevision) 16.dp else 11.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Icon(icon, contentDescription = accessibilityLabel, modifier = Modifier.size(22.dp))
            if (isTelevision) {
                Text(label, fontSize = 12.sp, fontWeight = FontWeight.Bold)
            }
        }
    }
}

@Composable
private fun PlayarrPlayerControlBar(
    playbackState: PlaybackState,
    timeline: PlayarrPlayerTimeline,
    controls: PlayarrPlaybackControls,
    isTelevision: Boolean,
    queue: PlayarrPlaybackQueue,
    seekFocusRequester: FocusRequester,
    canPrevious: Boolean,
    canNext: Boolean,
    scrubPositionMs: Long?,
    onScrub: (Long) -> Unit,
    onScrubFinished: () -> Unit,
    onTogglePlayback: () -> Unit,
    onPrevious: () -> Unit,
    onNext: () -> Unit,
    onMenu: (PlayarrPlayerMenu) -> Unit,
    playlistOpen: Boolean,
    onTogglePlaylist: () -> Unit,
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
            IconButton(onClick = onPrevious, enabled = canPrevious && !controls.switching) {
                Icon(
                    Icons.Outlined.SkipPrevious,
                    contentDescription = playarrString(PlayarrString.PlayerPreviousEpisode),
                    tint = if (canPrevious && !controls.switching) Color.White else Color.White.copy(alpha = 0.35f),
                )
            }
            IconButton(onClick = onTogglePlayback, enabled = !controls.switching) {
                Icon(
                    if (playbackState.playWhenReady) Icons.Outlined.Pause else Icons.Outlined.PlayArrow,
                    contentDescription = playarrString(
                        if (playbackState.playWhenReady) PlayarrString.PlayerPause else PlayarrString.PlayerPlay,
                    ),
                    tint = Color.White,
                    modifier = Modifier.size(if (isTelevision) 34.dp else 28.dp),
                )
            }
            IconButton(onClick = onNext, enabled = canNext && !controls.switching) {
                Icon(
                    Icons.Outlined.SkipNext,
                    contentDescription = playarrString(PlayarrString.PlayerNextEpisode),
                    tint = if (canNext && !controls.switching) Color.White else Color.White.copy(alpha = 0.35f),
                )
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
            if (controls.subtitleTracks.isNotEmpty()) {
                PlayerMenuButton(
                    Icons.Outlined.Subtitles,
                    playarrString(PlayarrString.PlayerSubtitlesHeading),
                    isTelevision,
                    !controls.switching,
                    playarrString(PlayarrString.PlayerSubtitleTrackMenuLabel),
                ) {
                    onMenu(PlayarrPlayerMenu.Subtitles)
                }
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
                        color = WebPink,
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
                TextButton(
                    onClick = onClose,
                    modifier = Modifier.semantics { contentDescription = closeDescription },
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
                                    color = if (active) WebPink else Color.White.copy(alpha = 0.54f),
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
        TextButton(onClick = onClick, enabled = enabled) {
            Icon(icon, contentDescription = null, tint = Color.White, modifier = Modifier.size(22.dp))
            Text(label, color = Color.White, modifier = Modifier.padding(start = 6.dp))
        }
    } else {
        IconButton(onClick = onClick, enabled = enabled) {
            Icon(icon, contentDescription = accessibilityLabel ?: label, tint = Color.White)
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
    AlertDialog(
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
                            detail = playarrString(PlayarrString.PlayerNoSubtitles),
                            selected = controls.selectedSubtitleTrackId == null,
                        ) { onSubtitle(null) }
                    }
                }
                when (menu) {
                    PlayarrPlayerMenu.Quality -> items(controls.qualityOptions.size) { index ->
                        val option = controls.qualityOptions[index]
                        PlayerDialogOption(
                            label = option.label,
                            detail = option.videoBitrateBps?.let { "${it / 1_000_000} Mbps" },
                            selected = option.id == controls.activeQualityId,
                        ) { onQuality(option.id) }
                    }
                    PlayarrPlayerMenu.Audio -> items(controls.audioTracks.size) { index ->
                        val track = controls.audioTracks[index]
                        PlayerDialogOption(
                            label = track.label,
                            detail = track.language,
                            selected = track.id == (controls.selectedAudioTrackId ?: controls.audioTracks.firstOrNull()?.id),
                        ) { onAudio(track.id) }
                    }
                    PlayarrPlayerMenu.Subtitles -> items(controls.subtitleTracks.size) { index ->
                        val track = controls.subtitleTracks[index]
                        PlayerDialogOption(
                            label = track.label,
                            detail = track.language,
                            selected = track.id == controls.selectedSubtitleTrackId,
                        ) { onSubtitle(track.id) }
                    }
                }
            }
        },
        confirmButton = {
            TextButton(onClick = onDismiss) { Text(playarrString(PlayarrString.CommonClose)) }
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
    OutlinedButton(onClick = onClick, modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.weight(1f), horizontalAlignment = Alignment.Start) {
            Text(label)
            detail?.let { Text(it, color = WebInkMuted, fontSize = 11.sp) }
        }
        if (selected) Text("✓", color = WebPink, fontWeight = FontWeight.Bold)
    }
}
