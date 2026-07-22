package io.streamarr.mobile.ui

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
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.ArrowBack
import androidx.compose.material.icons.outlined.HighQuality
import androidx.compose.material.icons.outlined.MusicNote
import androidx.compose.material.icons.outlined.Pause
import androidx.compose.material.icons.outlined.PlayArrow
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
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.onKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.streamarr.shared.player.PlaybackState
import kotlinx.coroutines.delay

private const val PLAYER_CONTROLS_TIMEOUT_MS = 3_500L

private enum class PlayarrPlayerMenu { Quality, Audio, Subtitles }

@Composable
internal fun PlayarrPlayerChrome(
    playbackState: PlaybackState,
    timeline: PlayarrPlayerTimeline,
    controls: PlayarrPlaybackControls,
    isTelevision: Boolean,
    onBack: () -> Unit,
    onTogglePlayback: () -> Unit,
    onSeek: (Long) -> Unit,
    onQuality: (String) -> Unit,
    onAudio: (String) -> Unit,
    onSubtitle: (String?) -> Unit,
    modifier: Modifier = Modifier,
) {
    var visible by remember { mutableStateOf(true) }
    var activityEpoch by remember { mutableLongStateOf(0L) }
    var openMenu by remember { mutableStateOf<PlayarrPlayerMenu?>(null) }
    var scrubPositionMs by remember { mutableStateOf<Long?>(null) }
    val surfaceFocusRequester = remember { FocusRequester() }
    val interactionSource = remember { MutableInteractionSource() }

    fun showControls() {
        visible = true
        activityEpoch += 1L
    }

    LaunchedEffect(visible, playbackState.playWhenReady, activityEpoch, openMenu, scrubPositionMs) {
        if (!visible || !playbackState.playWhenReady || openMenu != null || scrubPositionMs != null) return@LaunchedEffect
        delay(PLAYER_CONTROLS_TIMEOUT_MS)
        visible = false
        surfaceFocusRequester.requestFocus()
    }

    LaunchedEffect(Unit) { surfaceFocusRequester.requestFocus() }

    Box(modifier.fillMaxSize()) {
        Box(
            Modifier
                .fillMaxSize()
                .focusRequester(surfaceFocusRequester)
                .focusable()
                .onKeyEvent { event ->
                    if (event.type != KeyEventType.KeyDown || visible) return@onKeyEvent false
                    showControls()
                    true
                }
                .clickable(
                    interactionSource = interactionSource,
                    indication = null,
                ) {
                    visible = !visible
                    activityEpoch += 1L
                },
        )

        AnimatedVisibility(visible = visible, modifier = Modifier.align(Alignment.TopStart)) {
            IconButton(
                onClick = { showControls(); onBack() },
                modifier = Modifier
                    .windowInsetsPadding(WindowInsets.safeDrawing)
                    .padding(16.dp)
                    .background(Color.Black.copy(alpha = 0.62f), CircleShape),
            ) {
                Icon(Icons.Outlined.ArrowBack, contentDescription = "Back", tint = Color.White)
            }
        }

        AnimatedVisibility(visible = visible, modifier = Modifier.align(Alignment.BottomCenter)) {
            PlayarrPlayerControlBar(
                playbackState = playbackState,
                timeline = timeline,
                controls = controls,
                isTelevision = isTelevision,
                scrubPositionMs = scrubPositionMs,
                onScrub = { scrubPositionMs = it; showControls() },
                onScrubFinished = {
                    scrubPositionMs?.let(onSeek)
                    scrubPositionMs = null
                    showControls()
                },
                onTogglePlayback = { showControls(); onTogglePlayback() },
                onMenu = { openMenu = it; showControls() },
            )
        }

        if (controls.switching) {
            Surface(
                color = Color.Black.copy(alpha = 0.76f),
                shape = RoundedCornerShape(18.dp),
                modifier = Modifier.align(Alignment.Center),
            ) {
                Row(
                    Modifier.padding(18.dp),
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    CircularProgressIndicator(color = WebPink, modifier = Modifier.size(28.dp))
                    Text("Switching playback source…", color = Color.White)
                }
            }
        } else if (playbackState.isBuffering) {
            Surface(
                color = Color.Black.copy(alpha = 0.68f),
                shape = RoundedCornerShape(18.dp),
                modifier = Modifier.align(Alignment.Center),
            ) {
                Row(
                    Modifier.padding(18.dp),
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    CircularProgressIndicator(color = WebPink, modifier = Modifier.size(28.dp))
                    Text("Buffering…", color = Color.White)
                }
            }
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
}

@Composable
private fun PlayarrPlayerControlBar(
    playbackState: PlaybackState,
    timeline: PlayarrPlayerTimeline,
    controls: PlayarrPlaybackControls,
    isTelevision: Boolean,
    scrubPositionMs: Long?,
    onScrub: (Long) -> Unit,
    onScrubFinished: () -> Unit,
    onTogglePlayback: () -> Unit,
    onMenu: (PlayarrPlayerMenu) -> Unit,
) {
    val durationMs = timeline.durationMs.coerceAtLeast(0L)
    val displayedPositionMs = (scrubPositionMs ?: timeline.positionMs).coerceIn(0L, durationMs.coerceAtLeast(0L))
    val bufferedProgress = if (durationMs > 0L) {
        timeline.bufferedPositionMs.toFloat() / durationMs.toFloat()
    } else {
        0f
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
                .fillMaxWidth()
                .semantics {
                    contentDescription = "Seek ${formatPlayarrPlayerTime(displayedPositionMs)} of ${formatPlayarrPlayerTime(durationMs)}"
                },
        )
        Row(
            Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(if (isTelevision) 10.dp else 2.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            IconButton(onClick = onTogglePlayback, enabled = !controls.switching) {
                Icon(
                    if (playbackState.playWhenReady) Icons.Outlined.Pause else Icons.Outlined.PlayArrow,
                    contentDescription = if (playbackState.playWhenReady) "Pause" else "Play",
                    tint = Color.White,
                    modifier = Modifier.size(if (isTelevision) 34.dp else 28.dp),
                )
            }
            Text(
                "${formatPlayarrPlayerTime(displayedPositionMs)} / ${formatPlayarrPlayerTime(durationMs)}",
                color = Color.White,
                fontSize = if (isTelevision) 15.sp else 12.sp,
                fontWeight = FontWeight.SemiBold,
            )
            Spacer(Modifier.weight(1f))
            if (controls.audioTracks.isNotEmpty()) {
                PlayerMenuButton(Icons.Outlined.MusicNote, "Audio", isTelevision, !controls.switching) {
                    onMenu(PlayarrPlayerMenu.Audio)
                }
            }
            if (controls.subtitleTracks.isNotEmpty()) {
                PlayerMenuButton(Icons.Outlined.Subtitles, "Subtitles", isTelevision, !controls.switching) {
                    onMenu(PlayarrPlayerMenu.Subtitles)
                }
            }
            if (controls.qualityOptions.isNotEmpty()) {
                PlayerMenuButton(Icons.Outlined.HighQuality, "Quality", isTelevision, !controls.switching) {
                    onMenu(PlayarrPlayerMenu.Quality)
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
    onClick: () -> Unit,
) {
    if (isTelevision) {
        TextButton(onClick = onClick, enabled = enabled) {
            Icon(icon, contentDescription = null, tint = Color.White, modifier = Modifier.size(22.dp))
            Text(label, color = Color.White, modifier = Modifier.padding(start = 6.dp))
        }
    } else {
        IconButton(onClick = onClick, enabled = enabled) {
            Icon(icon, contentDescription = label, tint = Color.White)
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
                    PlayarrPlayerMenu.Quality -> "Quality"
                    PlayarrPlayerMenu.Audio -> "Audio"
                    PlayarrPlayerMenu.Subtitles -> "Subtitles"
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
                            label = "Off",
                            detail = null,
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
                            selected = track.id == controls.selectedAudioTrackId,
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
        confirmButton = { TextButton(onClick = onDismiss) { Text("Close") } },
    )
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
