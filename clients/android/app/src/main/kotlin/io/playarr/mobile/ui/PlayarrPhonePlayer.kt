package io.playarr.mobile.ui

import io.playarr.shared.designsystem.icons.PlayarrWebIcons
import android.app.Activity
import android.content.Context
import android.media.AudioManager
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.horizontalDrag
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.wrapContentSize
import androidx.compose.foundation.layout.asPaddingValues
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import io.playarr.shared.data.model.PlaybackQualityOption
import io.playarr.shared.player.PlaybackState

/*
 * The web phone player (`components/player/PlayerControls.tsx`, `PlayerSurface.tsx` under the phone media query),
 * metric for metric: the minimise and close buttons at the top right, a 48% scrim, then the controls block: a 6 px seek
 * track, the time, and a wrapping row of 42 px buttons that breaks after the quality button.
 */

private val PlayerAccent = Color(0xFFCF3157)
private val PlayerSeparator = Color(0xFF776B71)
private val PlayerPanel = Color(0xE6120E11)
private val PlayerMuted = Color.White.copy(alpha = 0.54f)

/** Where the web puts `max(14px, safe-area-inset-bottom)`. */
@Composable
private fun playerBottomInset(): Dp {
    val system = if (parityNoInsets) 0.dp else WindowInsets.navigationBars.asPaddingValues().calculateBottomPadding()
    return maxOf(14.dp, system)
}

/** The 3 tiers of the quality matrix, from `lib/qualityMatrix.ts`. */
private class QualityTier(val name: String, val resolution: String, val ids: List<String>)

private val QualityTiers = listOf(
    QualityTier("UHD", "2160p", listOf("h264-2160p-12mbps", "h264-2160p-20mbps", "h264-2160p-35mbps")),
    QualityTier("FHD", "1080p", listOf("h264-1080p-4mbps", "h264-1080p-8mbps", "h264-1080p-12mbps")),
    QualityTier("HD", "720p", listOf("h264-720p-2mbps", "h264-720p-4mbps", "h264-720p-6mbps")),
    QualityTier("SD", "480p", listOf("h264-480p-1mbps", "h264-480p-2mbps", "h264-480p-3mbps")),
)

private fun qualityBadge(option: PlaybackQualityOption?): String = when (option?.height) {
    2160 -> "UHD"
    1080 -> "FHD"
    720 -> "HD"
    480 -> "SD"
    else -> "HD"
}

/** `.player-btn`: a 42 px circle, dimmed when disabled. */
@Composable
private fun PhonePlayerButton(
    icon: ImageVector,
    description: String,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    primary: Boolean = false,
    onClick: () -> Unit,
) {
    Box(
        modifier
            .size(42.dp)
            .alpha(if (enabled) 1f else 0.28f)
            .clip(CircleShape)
            .then(if (primary) Modifier.background(Color.White.copy(alpha = 0.14f)) else Modifier)
            .clickable(enabled = enabled, onClick = onClick)
            .semantics { contentDescription = description },
        contentAlignment = Alignment.Center,
    ) {
        Icon(icon, contentDescription = null, tint = Color.White, modifier = Modifier.size(20.dp))
    }
}

/** `.player-close` / `.player-minimise` on a phone: 44 px glass circles. */
@Composable
private fun PhonePlayerCorner(icon: ImageVector, description: String, onClick: () -> Unit) {
    Box(
        Modifier
            .size(44.dp)
            .clip(CircleShape)
            .background(Color(0xFF0C0A0B).copy(alpha = 0.58f))
            .border(1.dp, Color.White.copy(alpha = 0.28f), CircleShape)
            .clickable(onClick = onClick)
            .semantics { contentDescription = description },
        contentAlignment = Alignment.Center,
    ) {
        Icon(icon, contentDescription = null, tint = Color.White, modifier = Modifier.size(20.dp))
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun BoxScope.PhonePlayerOverlay(
    visible: Boolean,
    playbackState: PlaybackState,
    timeline: PlayarrPlayerTimeline,
    controls: PlayarrPlaybackControls,
    canPrevious: Boolean,
    canNext: Boolean,
    scrubPositionMs: Long?,
    onScrub: (Long) -> Unit,
    onScrubFinished: () -> Unit,
    onTogglePlayback: () -> Unit,
    onPrevious: () -> Unit,
    onNext: () -> Unit,
    openMenu: PlayarrPlayerMenu?,
    onMenu: (PlayarrPlayerMenu?) -> Unit,
    onQuality: (String) -> Unit,
    onAudio: (String) -> Unit,
    onSubtitle: (String?) -> Unit,
    onTogglePlaylist: () -> Unit,
    onMinimise: (() -> Unit)?,
    onBack: () -> Unit,
    onHealth: (() -> Unit)?,
    onPlayOnDevice: (() -> Unit)?,
    onCast: (() -> Unit)?,
    castConnected: Boolean,
    onActivity: () -> Unit,
) {
    val context = LocalContext.current
    val topInset = webPhoneInsets().asPaddingValues().calculateTopPadding()
    val bottomInset = playerBottomInset()
    var fullscreen by remember { mutableStateOf(false) }
    var muted by remember { mutableStateOf(false) }
    val durationMs = timeline.durationMs.coerceAtLeast(0L)
    val displayedMs = (scrubPositionMs ?: timeline.positionMs).coerceIn(0L, durationMs)
    val activeQuality = controls.qualityOptions.firstOrNull { it.id == controls.activeQualityId } ?: controls.qualityOptions.firstOrNull()

    AnimatedVisibility(visible = visible, enter = PlayerChromeFadeEnter, exit = PlayerChromeFadeExit, modifier = Modifier.align(Alignment.TopEnd)) {
        Row(Modifier.padding(end = 16.dp, top = topInset), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            if (onMinimise != null) {
                PhonePlayerCorner(PlayarrWebIcons.PlayerMinimise, playarrString(PlayarrString.PlayerMinimise)) { onActivity(); onMinimise() }
            }
            PhonePlayerCorner(PlayarrWebIcons.PlayerClose, playarrString(PlayarrString.PlayerClosePlayer), onBack)
        }
    }

    PlayarrPlayerScrim(visible = visible)

    AnimatedVisibility(visible = visible, enter = PlayerChromeFadeEnter, exit = PlayerChromeFadeExit, modifier = Modifier.align(Alignment.BottomCenter)) {
        Column(
            Modifier.fillMaxWidth().padding(start = 12.dp, end = 12.dp, bottom = bottomInset),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            val bufferedFraction = if (durationMs > 0L) (timeline.bufferedPositionMs.toFloat() / durationMs).coerceIn(0f, 1f) else 0f
            val playedFraction = if (durationMs > 0L) (displayedMs.toFloat() / durationMs).coerceIn(0f, 1f) else 0f
            val seekDescription = playarrString(
                PlayarrString.PlayerSeekValueText,
                "position" to formatPlayarrPlayerTime(displayedMs),
                "duration" to formatPlayarrPlayerTime(durationMs),
            )
            // `.player-seek-track`: 6 px, the buffered range and the played range over a 20% white track.
            Box(
                Modifier
                    .fillMaxWidth()
                    .height(6.dp)
                    .background(Color.White.copy(alpha = 0.2f))
                    .semantics { contentDescription = seekDescription }
                    .pointerInput(durationMs, controls.switching) {
                        if (durationMs <= 0L || controls.switching) return@pointerInput
                        awaitEachGesture {
                            val down = awaitFirstDown()
                            fun at(x: Float) = (x / size.width).coerceIn(0f, 1f) * durationMs
                            onScrub(at(down.position.x).toLong())
                            horizontalDrag(down.id) { change ->
                                onScrub(at(change.position.x).toLong())
                                change.consume()
                            }
                            onScrubFinished()
                        }
                    },
            ) {
                Box(Modifier.fillMaxHeight().fillMaxWidth(bufferedFraction).background(Color.White.copy(alpha = 0.34f)))
                Box(Modifier.fillMaxHeight().fillMaxWidth(playedFraction).background(PlayerAccent))
            }
            FlowRow(
                Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(2.dp, Alignment.CenterHorizontally),
                verticalArrangement = Arrangement.spacedBy(2.dp),
            ) {
                // `.player-time` leads the first line (order -1, full width) with 2 px of padding below.
                Row(
                    Modifier.fillMaxWidth().padding(bottom = 2.dp),
                    horizontalArrangement = Arrangement.spacedBy(5.6.dp, Alignment.CenterHorizontally),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    val time = androidx.compose.ui.text.TextStyle(fontSize = 9.92.sp, lineHeight = 14.88.sp, fontFeatureSettings = "tnum")
                    Text(formatPlayarrPlayerTime(displayedMs), color = Color.White, style = WebTextStyle.merge(time))
                    Text("/", color = PlayerSeparator, style = WebTextStyle.merge(time))
                    Text(formatPlayarrPlayerTime(durationMs), color = Color.White, style = WebTextStyle.merge(time))
                }
                PhonePlayerButton(PlayarrWebIcons.PlayerPrevious, playarrString(PlayarrString.PlayerPreviousEpisode), enabled = canPrevious && !controls.switching) { onPrevious() }
                PhonePlayerButton(
                    if (playbackState.playWhenReady) PlayarrWebIcons.PlayerPause else PlayarrWebIcons.PlayerPlay,
                    playarrString(if (playbackState.playWhenReady) PlayarrString.PlayerPause else PlayarrString.PlayerPlay),
                    enabled = !controls.switching, primary = true,
                ) { onTogglePlayback() }
                PhonePlayerButton(PlayarrWebIcons.PlayerNext, playarrString(PlayarrString.PlayerNextEpisode), enabled = canNext && !controls.switching) { onNext() }
                PhonePlayerButton(
                    if (muted) PlayarrWebIcons.PlayerVolumeMuted else PlayarrWebIcons.PlayerVolumeHigh,
                    playarrString(if (muted) PlayarrString.PlayerUnmute else PlayarrString.PlayerMute),
                ) {
                    onActivity()
                    val audio = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
                    audio.adjustStreamVolume(AudioManager.STREAM_MUSIC, AudioManager.ADJUST_TOGGLE_MUTE, 0)
                    muted = audio.isStreamMute(AudioManager.STREAM_MUSIC)
                }
                PhonePlayerButton(PlayarrWebIcons.PlayerAudio, playarrString(PlayarrString.PlayerAudioTrackMenuLabel), enabled = controls.audioTracks.isNotEmpty() && !controls.switching) {
                    onMenu(if (openMenu == PlayarrPlayerMenu.Audio) null else PlayarrPlayerMenu.Audio)
                }
                PhonePlayerButton(PlayarrWebIcons.PlayerSubtitles, playarrString(PlayarrString.PlayerSubtitleTrackMenuLabel), enabled = !controls.switching) {
                    onMenu(if (openMenu == PlayarrPlayerMenu.Subtitles) null else PlayarrPlayerMenu.Subtitles)
                }
                PhonePlayerButton(PlayarrWebIcons.PlayerPlaylist, playarrString(PlayarrString.PlayerClosePlaylist), enabled = !controls.switching) { onTogglePlaylist() }
                // `.player-quality-button`: a 42 px box whose HD glyph and wrapped label overflow it on both sides.
                Box(
                    Modifier
                        .size(42.dp)
                        .then(if (controls.qualityOptions.isEmpty() || controls.switching) Modifier.alpha(0.76f) else Modifier)
                        // `.player-quality-button[aria-expanded="true"]`: a 15% white disc and 1.08x while its menu is open.
                        .then(
                            if (openMenu == PlayarrPlayerMenu.Quality) {
                                Modifier.graphicsLayer { scaleX = 1.08f; scaleY = 1.08f }.background(Color.White.copy(alpha = 0.15f), CircleShape)
                            } else {
                                Modifier
                            },
                        )
                        .clickable(enabled = controls.qualityOptions.isNotEmpty() && !controls.switching) {
                            onMenu(if (openMenu == PlayarrPlayerMenu.Quality) null else PlayarrPlayerMenu.Quality)
                        }
                        .semantics { contentDescription = "Quality" },
                    contentAlignment = Alignment.Center,
                ) {
                    Row(Modifier.wrapContentSize(Alignment.Center, unbounded = true), verticalAlignment = Alignment.CenterVertically) {
                        Box(Modifier.offset(x = 3.05.dp).width(22.dp).height(20.dp), contentAlignment = Alignment.Center) {
                            Text(
                                qualityBadge(activeQuality), color = Color.White, fontSize = 7.68.sp, lineHeight = 11.52.sp,
                                fontWeight = FontWeight.Bold, letterSpacing = 0.3072.sp, style = WebTextStyle, maxLines = 1, softWrap = false,
                            )
                        }
                        Spacer(Modifier.width(8.8.dp))
                        Text(
                            activeQuality?.let { playarrQualityLabel(it.label, it.videoBitrateBps, it.id == "original") }.orEmpty(),
                            color = Color.White, fontSize = 10.56.sp, lineHeight = 15.84.sp, fontWeight = FontWeight.Bold,
                            letterSpacing = 0.1056.sp, textAlign = TextAlign.Center, style = WebTextStyle,
                            modifier = Modifier.width(44.dp),
                        )
                    }
                }
                if (onCast != null) {
                    PhonePlayerButton(PlayarrWebIcons.PlayerPlayOn, playarrString(PlayarrString.CastButtonLabel)) { onActivity(); onCast() }
                }
                if (onHealth != null) {
                    PhonePlayerButton(PlayarrWebIcons.PlayerHealth, playarrString(PlayarrString.HealthOpen)) { onActivity(); onHealth() }
                }
                if (onPlayOnDevice != null) {
                    PhonePlayerButton(PlayarrWebIcons.PlayerPlayOn, playarrString(PlayarrString.RemotePlayOnTitle)) { onActivity(); onPlayOnDevice() }
                }
                PhonePlayerButton(
                    if (fullscreen) PlayarrWebIcons.PlayerFullscreenExit else PlayarrWebIcons.PlayerFullscreenEnter,
                    playarrString(if (fullscreen) PlayarrString.PlayerExitFullscreen else PlayarrString.PlayerEnterFullscreen),
                ) {
                    onActivity()
                    fullscreen = !fullscreen
                    val window = (context as? Activity)?.window
                    if (window != null) {
                        val controller = WindowCompat.getInsetsController(window, window.decorView)
                        if (fullscreen) controller.hide(WindowInsetsCompat.Type.systemBars()) else controller.show(WindowInsetsCompat.Type.systemBars())
                    }
                }
            }
        }
    }

    if (openMenu != null) {
        PhonePlayerMenuPanel(
            menu = openMenu, controls = controls, bottomInset = bottomInset,
            onDismiss = { onMenu(null) }, onQuality = onQuality, onAudio = onAudio, onSubtitle = onSubtitle,
        )
    }
}

/** The menu's heading and rows; shared by the blurred window and the in-composition fallback. */
@Composable
private fun PhoneMenuPanelContent(
    menu: PlayarrPlayerMenu,
    controls: PlayarrPlaybackControls,
    onQuality: (String) -> Unit,
    onAudio: (String) -> Unit,
    onSubtitle: (String?) -> Unit,
) {
    val locale = LocalPlayarrLanguage.current.locale
    Column(
        Modifier.heightIn(max = 489.5.dp).verticalScroll(rememberScrollState()).padding(8.8.dp),
    ) {
        Text(
            when (menu) {
                PlayarrPlayerMenu.Quality -> playarrString(PlayarrString.PlayerQualityHeading)
                PlayarrPlayerMenu.Audio -> playarrString(PlayarrString.PlayerAudioHeading)
                PlayarrPlayerMenu.Subtitles -> playarrString(PlayarrString.PlayerSubtitlesHeading)
            }.uppercase(locale),
            color = Color.White.copy(alpha = 0.56f), fontSize = 8.64.sp, lineHeight = 12.96.sp, fontWeight = FontWeight(760),
            letterSpacing = 1.296.sp, style = WebTextStyle,
            modifier = Modifier.padding(start = 11.2.dp, end = 11.2.dp, top = 8.8.dp, bottom = 7.2.dp),
        )
        when (menu) {
            PlayarrPlayerMenu.Quality -> PhoneQualityMatrix(controls, onQuality)
            PlayarrPlayerMenu.Audio -> controls.audioTracks.forEach { track ->
                val selected = track.id == (controls.selectedAudioTrackId ?: controls.audioTracks.firstOrNull()?.id)
                PhoneMenuOption(
                    playarrAudioTrackLabel(track, locale, playarrString(PlayarrString.PlayerChannelsMono), playarrString(PlayarrString.PlayerChannelsStereo)),
                    null, selected,
                ) { onAudio(track.id) }
            }
            PlayarrPlayerMenu.Subtitles -> {
                PhoneMenuOption(
                    playarrString(PlayarrString.PlayerOff),
                    playarrString(if (controls.subtitleTracks.isEmpty()) PlayarrString.PlayerNoSubtitleTracksAvailable else PlayarrString.PlayerNoSubtitles),
                    controls.selectedSubtitleTrackId == null,
                ) { onSubtitle(null) }
                controls.subtitleTracks.forEach { track ->
                    PhoneMenuOption(
                        playarrSubtitleTrackLabel(track, locale, playarrString(PlayarrString.PlayerSubtitleForced)),
                        null, track.id == controls.selectedSubtitleTrackId,
                    ) { onSubtitle(track.id) }
                }
            }
        }
    }
}

/**
 * `.player-quality-menu` on a phone: fixed 12 px from both sides, 96 px above the bottom, scrolling past 58% of the height.
 * The web blurs what is behind it (`backdrop-filter: blur(24px)`). From API 31 the panel is a window sized to the panel
 * whose background blur is switched on, so only the video behind the panel is blurred; below API 31 it is drawn in place
 * with the same 90% tint and no blur.
 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun BoxScope.PhonePlayerMenuPanel(
    menu: PlayarrPlayerMenu,
    controls: PlayarrPlaybackControls,
    bottomInset: Dp,
    onDismiss: () -> Unit,
    onQuality: (String) -> Unit,
    onAudio: (String) -> Unit,
    onSubtitle: (String?) -> Unit,
) {
    val shape = RoundedCornerShape(18.dp)
    if (android.os.Build.VERSION.SDK_INT >= 31) {
        BlurredMenuWindow(bottomMargin = 96.dp - 14.dp + bottomInset, onDismiss = onDismiss) {
            Box(Modifier.fillMaxWidth().border(1.dp, Color.White.copy(alpha = 0.18f), shape)) {
                PhoneMenuPanelContent(menu, controls, onQuality, onAudio, onSubtitle)
            }
        }
        return
    }
    Box(
        Modifier.fillMaxSize().clickable(interactionSource = remember { MutableInteractionSource() }, indication = null, onClick = onDismiss),
    )
    WebShadowedBox(
        shadows = listOf(WebShadow(24.dp, 70.dp, Color.Black.copy(alpha = 0.5f))),
        shape = shape,
        modifier = Modifier.align(Alignment.BottomCenter).fillMaxWidth().padding(start = 12.dp, end = 12.dp, bottom = 96.dp - 14.dp + bottomInset),
        innerFill = false,
        innerWidthFill = true,
        innerModifier = Modifier.background(PlayerPanel).border(1.dp, Color.White.copy(alpha = 0.18f), shape),
    ) {
        PhoneMenuPanelContent(menu, controls, onQuality, onAudio, onSubtitle)
    }
}

/** A dialog window that is exactly the panel (12 dp side margins, [bottomMargin] up) with the system's background blur on. */
@androidx.annotation.RequiresApi(31)
@Composable
private fun BlurredMenuWindow(bottomMargin: Dp, onDismiss: () -> Unit, content: @Composable () -> Unit) {
    androidx.compose.ui.window.Dialog(
        onDismissRequest = onDismiss,
        properties = androidx.compose.ui.window.DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false),
    ) {
        val window = (androidx.compose.ui.platform.LocalView.current.parent as? androidx.compose.ui.window.DialogWindowProvider)?.window
        val density = androidx.compose.ui.platform.LocalDensity.current
        val metrics = LocalContext.current.resources.displayMetrics
        androidx.compose.runtime.SideEffect {
            window?.let { w ->
                val shapeBg = android.graphics.drawable.GradientDrawable().apply {
                    shape = android.graphics.drawable.GradientDrawable.RECTANGLE
                    cornerRadius = with(density) { 18.dp.toPx() }
                    setColor(0xE6120E11.toInt())
                }
                w.setBackgroundDrawable(shapeBg)
                w.clearFlags(android.view.WindowManager.LayoutParams.FLAG_DIM_BEHIND)
                // CSS blur(24px) is a Gaussian of sigma 24 CSS px; the window blur radius is in device pixels.
                w.setBackgroundBlurRadius(with(density) { 24.dp.roundToPx() })
                w.setGravity(android.view.Gravity.BOTTOM or android.view.Gravity.CENTER_HORIZONTAL)
                w.attributes = w.attributes.apply {
                    width = metrics.widthPixels - with(density) { 24.dp.roundToPx() }
                    height = android.view.WindowManager.LayoutParams.WRAP_CONTENT
                    y = with(density) { bottomMargin.roundToPx() }
                }
            }
        }
        content()
    }
}

/** `.player-quality-option`: a 54 px row, the selected one tinted rose. */
@Composable
private fun PhoneMenuOption(label: String, detail: String?, selected: Boolean, onClick: () -> Unit) {
    Row(
        Modifier
            .fillMaxWidth().heightIn(min = 54.dp).clip(RoundedCornerShape(12.dp))
            .background(if (selected) PlayerAccent.copy(alpha = 0.2f) else Color.Transparent)
            .clickable(onClick = onClick).padding(horizontal = 11.52.dp, vertical = 9.92.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.4.dp)) {
            Text(label, color = Color.White, fontSize = 11.04.sp, lineHeight = 16.56.sp, fontWeight = FontWeight.Bold, style = WebTextStyle)
            detail?.let { Text(it, color = Color.White.copy(alpha = 0.55f), fontSize = 8.32.sp, lineHeight = 12.48.sp, style = WebTextStyle) }
        }
        Text(if (selected) "✓" else "", color = PlayerAccent, fontSize = 13.76.sp, lineHeight = 20.sp, textAlign = TextAlign.Center, style = WebTextStyle, modifier = Modifier.width(24.dp))
    }
}

/** `QualityMatrix` (variant player): the standalone choices above a 4 x 4 grid of tier by level. */
@Composable
private fun PhoneQualityMatrix(controls: PlayarrPlaybackControls, onQuality: (String) -> Unit) {
    val byId = controls.qualityOptions.associateBy { it.id }
    val matrixIds = QualityTiers.flatMap { it.ids }.toSet()
    val standalone = controls.qualityOptions.filter { it.id !in matrixIds }
    if (standalone.isNotEmpty()) {
        Column(Modifier.padding(bottom = 8.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            standalone.forEach { option ->
                val selected = option.id == controls.activeQualityId
                PhoneMatrixChoice(
                    title = playarrQualityLabel(option.label, option.videoBitrateBps, option.id == "original"),
                    detail = if (option.id == "original") playarrString(PlayarrString.PlayerQualitySource) else playarrQualityBitrateDetail(option.videoBitrateBps),
                    selected = selected, enabled = !controls.switching, modifier = Modifier.fillMaxWidth(), check = true,
                ) { onQuality(option.id) }
            }
        }
    }
    val levels = listOf(PlayarrString.SettingsQualityLow, PlayarrString.SettingsQualityMedium, PlayarrString.SettingsQualityHigh)
    val locale = LocalPlayarrLanguage.current.locale
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            Spacer(Modifier.weight(0.72f))
            levels.forEach { level ->
                Text(
                    playarrString(level).uppercase(locale),
                    color = PlayerMuted, fontSize = 7.68.sp, lineHeight = 11.52.sp, fontWeight = FontWeight(760), letterSpacing = 0.6144.sp,
                    textAlign = TextAlign.Center, style = WebTextStyle,
                    modifier = Modifier.weight(1f).padding(horizontal = 3.2.dp, vertical = 6.08.dp),
                )
            }
        }
        QualityTiers.forEach { tier ->
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(0.72f).padding(horizontal = 4.dp), verticalArrangement = Arrangement.spacedBy(1.92.dp)) {
                    Text(tier.name, color = Color.White, fontSize = 8.96.sp, lineHeight = 13.44.sp, fontWeight = FontWeight(760), style = WebTextStyle, maxLines = 1)
                    Text(tier.resolution, color = PlayerMuted, fontSize = 7.04.sp, lineHeight = 10.56.sp, style = WebTextStyle, maxLines = 1)
                }
                tier.ids.forEachIndexed { index, id ->
                    val option = byId[id]
                    val levelLabel = playarrString(levels[index])
                    if (option != null) {
                        PhoneMatrixChoice(
                            title = playarrQualityBitrateDetail(option.videoBitrateBps) ?: option.label,
                            detail = levelLabel, selected = id == controls.activeQualityId, enabled = !controls.switching,
                            modifier = Modifier.weight(1f), check = false,
                        ) { onQuality(id) }
                    } else {
                        Spacer(Modifier.weight(1f).height(48.dp))
                    }
                }
            }
        }
    }
}

@Composable
private fun PhoneMatrixChoice(
    title: String,
    detail: String?,
    selected: Boolean,
    enabled: Boolean,
    modifier: Modifier,
    check: Boolean,
    onClick: () -> Unit,
) {
    val shape = RoundedCornerShape(10.dp)
    Row(
        modifier
            .height(48.dp).clip(shape)
            .background(if (selected) PlayerAccent.copy(alpha = 0.22f) else Color.White.copy(alpha = 0.055f))
            .border(1.dp, if (selected) PlayerAccent.copy(alpha = 0.62f) else Color.White.copy(alpha = 0.1f), shape)
            .clickable(enabled = enabled, onClick = onClick)
            .padding(horizontal = 10.88.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f, fill = check).offset(y = (-1.5).dp), verticalArrangement = Arrangement.spacedBy(1.92.dp)) {
            Text(title, color = Color.White, fontSize = 9.28.sp, lineHeight = 13.92.sp, fontWeight = FontWeight.Bold, style = WebTextStyle, maxLines = 1)
            detail?.let { Text(it, color = PlayerMuted, fontSize = 7.04.sp, lineHeight = 10.56.sp, style = WebTextStyle, maxLines = 1) }
        }
        if (check) Text(if (selected) "✓" else "", color = PlayerAccent, fontSize = 11.84.sp, lineHeight = 17.76.sp, textAlign = TextAlign.Center, style = WebTextStyle, modifier = Modifier.width(16.dp))
    }
}
