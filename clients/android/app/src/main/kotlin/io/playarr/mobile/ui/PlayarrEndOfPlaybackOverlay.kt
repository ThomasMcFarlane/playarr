package io.playarr.mobile.ui

import android.util.Log
import android.view.KeyEvent
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsFocusedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.outlined.PlayArrow
import androidx.compose.material.icons.outlined.Replay
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.isTraversalGroup
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.paneTitle
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import coil3.compose.AsyncImage
import coil3.network.NetworkHeaders
import coil3.network.httpHeaders
import coil3.request.ImageRequest
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.repeatOnLifecycle
import io.playarr.shared.data.model.ImageKind
import io.playarr.shared.data.model.Work
import io.playarr.shared.player.PlaybackState
import kotlinx.coroutines.delay

private const val END_CARD_STATS_TAG = "PlayarrPlaybackStats"

/**
 * Owns the end-card state machine for one player screen: raises it when
 * playback ends, runs the countdown (only while the screen is resumed),
 * executes effects and logs telemetry. [state] is hoisted so the caller can
 * hide the regular player chrome while the card is up.
 */
@Composable
internal fun PlayarrEndOfPlaybackHost(
    state: PlayarrEndCardState,
    onStateChange: (PlayarrEndCardState) -> Unit,
    playbackState: PlaybackState,
    item: PlayarrPlaybackQueueItem?,
    nextItem: PlayarrPlaybackQueueItem?,
    casting: Boolean,
    suggestions: List<Work>,
    isTelevision: Boolean,
    serverUrl: String,
    accessToken: String?,
    onPlayNext: () -> Unit,
    onReplay: () -> Unit,
    onPrewarmNext: (String) -> Unit,
    onDiscardPrewarm: () -> Unit,
    onExit: () -> Unit,
    onOpenWork: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    val currentState by rememberUpdatedState(state)
    val currentSuggestions by rememberUpdatedState(suggestions)
    val mediaFileId = item?.mediaFileId
    fun dispatch(event: PlayarrEndCardEvent) {
        val (next, effect) = reducePlayarrEndCard(currentState, event)
        onStateChange(next)
        val kind = playarrEndCardKind(currentState)
        if (event == PlayarrEndCardEvent.Cancel || event == PlayarrEndCardEvent.Exit ||
            event == PlayarrEndCardEvent.Replay || event is PlayarrEndCardEvent.SelectSuggestion
        ) {
            onDiscardPrewarm()
        }
        if (event == PlayarrEndCardEvent.Cancel && currentState.hasNext) {
            Log.i(END_CARD_STATS_TAG, playarrEndScreenActionLogLine("cancel", kind, mediaFileId))
        }
        playarrEndCardActionName(effect)?.let {
            Log.i(END_CARD_STATS_TAG, playarrEndScreenActionLogLine(it, kind, mediaFileId))
        }
        if (effect == PlayarrEndCardEffect.AdvanceAutomatically) {
            Log.i(END_CARD_STATS_TAG, playarrEndScreenAutoplayLogLine(mediaFileId))
        }
        when (effect) {
            PlayarrEndCardEffect.AdvanceAutomatically, PlayarrEndCardEffect.AdvanceNow -> onPlayNext()
            PlayarrEndCardEffect.Replay -> onReplay()
            PlayarrEndCardEffect.Exit -> onExit()
            is PlayarrEndCardEffect.OpenSuggestion -> onOpenWork(effect.workId)
            PlayarrEndCardEffect.None -> Unit
        }
    }

    // The item the card may be raised for. Cleared only by observing a
    // non-ended state, so the item swapped in by "play next" (whose engine state
    // is still ENDED for a frame) cannot re-raise the card.
    var armedFor by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(casting) {
        // Casting begins while the card is up: drop it (and its countdown).
        if (casting && currentState.visible) onStateChange(PlayarrEndCardState())
    }
    LaunchedEffect(playbackState.hasEnded, mediaFileId, casting) {
        if (!playbackState.hasEnded) {
            armedFor = mediaFileId
            if (currentState.visible) onStateChange(PlayarrEndCardState())
        } else if ((armedFor == null || armedFor == mediaFileId) && shouldShowPlayarrEndCard(item, casting, playbackState.error != null) && !currentState.visible) {
            val (next, _) = reducePlayarrEndCard(currentState, PlayarrEndCardEvent.Ended(nextItem != null))
            onStateChange(next)
            Log.i(END_CARD_STATS_TAG, playarrEndScreenShownLogLine(next, mediaFileId, currentSuggestions.size))
        }
    }

    // Warm the next item's playback info once the countdown is up (after
    // STATE_ENDED), so Play now / autoplay does not start from a cold negotiation.
    val nextMediaFileId = nextItem?.mediaFileId
    LaunchedEffect(state.mode, nextMediaFileId) {
        if (state.mode == PlayarrEndCardMode.Countdown && nextMediaFileId != null) onPrewarmNext(nextMediaFileId)
    }

    val lifecycle = LocalLifecycleOwner.current.lifecycle
    LaunchedEffect(state.counting) {
        if (!state.counting) return@LaunchedEffect
        lifecycle.repeatOnLifecycle(Lifecycle.State.RESUMED) {
            while (true) {
                delay(PLAYER_UP_NEXT_TICK_MS)
                dispatch(PlayarrEndCardEvent.Tick(PLAYER_UP_NEXT_TICK_MS))
            }
        }
    }

    if (!state.visible || item == null) return
    BackHandler { dispatch(PlayarrEndCardEvent.Exit) }
    PlayarrEndOfPlaybackOverlay(
        state = state,
        item = item,
        nextItem = nextItem,
        suggestions = suggestions,
        isTelevision = isTelevision,
        serverUrl = serverUrl,
        accessToken = accessToken,
        dispatch = ::dispatch,
        modifier = modifier,
    )
}

@Composable
internal fun PlayarrEndOfPlaybackOverlay(
    state: PlayarrEndCardState,
    item: PlayarrPlaybackQueueItem,
    nextItem: PlayarrPlaybackQueueItem?,
    suggestions: List<Work>,
    isTelevision: Boolean,
    serverUrl: String,
    accessToken: String?,
    dispatch: (PlayarrEndCardEvent) -> Unit,
    modifier: Modifier = Modifier,
) {
    val language = LocalPlayarrLanguage.current
    val primaryFocus = remember { FocusRequester() }
    val rowState = rememberLazyListState()
    var rowFocused by remember { mutableStateOf(false) }
    val browsing = rowFocused || rowState.isScrollInProgress
    LaunchedEffect(browsing) {
        if (PLAYER_UP_NEXT_PAUSE_ON_BROWSE) dispatch(PlayarrEndCardEvent.BrowsingSuggestions(browsing))
    }
    // Default focus: Play now / Play next when something is queued, else Replay.
    // Replay is non-destructive, keeps the viewer on the card, and does not move
    // when suggestions finish loading; DPAD-down reaches the row in one press.
    LaunchedEffect(state.mode) { runCatching { primaryFocus.requestFocus() } }

    val padding = if (isTelevision) 48.dp else 20.dp
    val dialogDescription = if (state.hasNext && nextItem != null) {
        playarrString(PlayarrString.EndCardUpNextTitle, "title" to nextItem.displayTitle(language))
    } else {
        playarrString(PlayarrString.EndCardFinishedPlaying, "title" to item.displayTitle(language))
    }
    Box(
        modifier
            .fillMaxSize()
            .background(Color.Black.copy(alpha = 0.86f))
            .semantics {
                paneTitle = dialogDescription
                isTraversalGroup = true
            }
            .onPreviewKeyEvent { event ->
                // Media keys (spec section 6): play/pause = primary action,
                // next = Play now, fast-forward/rewind swallowed.
                if (event.type != KeyEventType.KeyDown) return@onPreviewKeyEvent false
                when (event.nativeKeyEvent.keyCode) {
                    KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE, KeyEvent.KEYCODE_MEDIA_PLAY -> {
                        dispatch(if (state.hasNext) PlayarrEndCardEvent.PlayNow else PlayarrEndCardEvent.Replay)
                        true
                    }
                    KeyEvent.KEYCODE_MEDIA_NEXT -> {
                        if (state.hasNext) dispatch(PlayarrEndCardEvent.PlayNow)
                        true
                    }
                    KeyEvent.KEYCODE_MEDIA_FAST_FORWARD, KeyEvent.KEYCODE_MEDIA_REWIND -> true
                    else -> false
                }
            },
    ) {
        item.artworkWork?.let { work ->
            AuthenticatedArtwork(
                work = work,
                kinds = listOf(ImageKind.Backdrop, ImageKind.Thumb, ImageKind.Poster),
                serverUrl = serverUrl,
                accessToken = accessToken,
                contentScale = ContentScale.Crop,
                modifier = Modifier.fillMaxSize().alpha(0.22f),
            )
        }
        Box(
            Modifier.fillMaxSize().background(
                Brush.verticalGradient(listOf(Color.Black.copy(alpha = 0.5f), Color.Black.copy(alpha = 0.92f))),
            ),
        )
        Column(
            Modifier
                .fillMaxSize()
                .windowInsetsPadding(WindowInsets.safeDrawing)
                .verticalScroll(rememberScrollState())
                .padding(horizontal = padding, vertical = 24.dp),
            verticalArrangement = Arrangement.spacedBy(20.dp),
        ) {
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(
                    playarrString(PlayarrString.EndCardFinished).uppercase(language.locale),
                    color = WebPink,
                    fontSize = 11.sp,
                    fontWeight = FontWeight.ExtraBold,
                )
                Text(
                    item.displayTitle(language),
                    color = Color.White,
                    fontSize = if (isTelevision) 30.sp else 22.sp,
                    fontWeight = FontWeight.Bold,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
                item.subtitle?.let { Text(it, color = Color.White.copy(alpha = 0.68f), fontSize = 13.sp, maxLines = 1) }
            }

            if (state.hasNext && nextItem != null) {
                PlayarrUpNextCard(
                    state = state,
                    nextItem = nextItem,
                    isTelevision = isTelevision,
                    serverUrl = serverUrl,
                    accessToken = accessToken,
                    primaryFocus = primaryFocus,
                    dispatch = dispatch,
                )
            }

            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                PlayarrEndCardButton(
                    label = playarrString(PlayarrString.EndCardReplay),
                    icon = Icons.Outlined.Replay,
                    isTelevision = isTelevision,
                    onClick = { dispatch(PlayarrEndCardEvent.Replay) },
                    modifier = if (state.hasNext) Modifier else Modifier.focusRequester(primaryFocus),
                )
                PlayarrEndCardButton(
                    label = playarrString(PlayarrString.EndCardExit),
                    accessibilityLabel = playarrString(PlayarrString.PlayerBackToDetails),
                    icon = Icons.AutoMirrored.Outlined.ArrowBack,
                    isTelevision = isTelevision,
                    onClick = { dispatch(PlayarrEndCardEvent.Exit) },
                )
            }

            if (suggestions.isNotEmpty()) {
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Text(
                        playarrString(PlayarrString.EndCardMoreToWatch),
                        color = Color.White,
                        fontSize = 18.sp,
                        fontWeight = FontWeight.SemiBold,
                    )
                    LazyRow(
                        state = rowState,
                        modifier = Modifier.onFocusChanged { rowFocused = it.hasFocus },
                        horizontalArrangement = Arrangement.spacedBy(12.dp),
                        contentPadding = PaddingValues(vertical = 6.dp, horizontal = 4.dp),
                    ) {
                        items(suggestions, key = Work::id) { work ->
                            PlayarrSuggestionTile(
                                work = work,
                                isTelevision = isTelevision,
                                serverUrl = serverUrl,
                                accessToken = accessToken,
                                onClick = { dispatch(PlayarrEndCardEvent.SelectSuggestion(work.id)) },
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun PlayarrUpNextCard(
    state: PlayarrEndCardState,
    nextItem: PlayarrPlaybackQueueItem,
    isTelevision: Boolean,
    serverUrl: String,
    accessToken: String?,
    primaryFocus: FocusRequester,
    dispatch: (PlayarrEndCardEvent) -> Unit,
) {
    val language = LocalPlayarrLanguage.current
    val countdown = state.mode == PlayarrEndCardMode.Countdown
    // Announced politely at the start (10) and at 5 only: the description
    // changes twice, while the visible number changes every second.
    val announced = playarrString(
        PlayarrString.EndCardCountdownDescription,
        "seconds" to if (state.remainingSeconds > 5) PLAYER_UP_NEXT_COUNTDOWN_MS / 1_000L else 5L,
    )
    Surface(
        color = Color.White.copy(alpha = 0.08f),
        shape = RoundedCornerShape(16.dp),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Row(
            Modifier.padding(16.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Box(Modifier.width(if (isTelevision) 280.dp else 140.dp).aspectRatio(16f / 9f)) {
                nextItem.artworkWork?.let { work ->
                    AuthenticatedArtwork(
                        work = work,
                        kinds = listOf(ImageKind.Thumb, ImageKind.Backdrop, ImageKind.Poster),
                        serverUrl = serverUrl,
                        accessToken = accessToken,
                        contentScale = ContentScale.Crop,
                        modifier = Modifier.fillMaxSize().background(Color.White.copy(alpha = 0.08f)),
                    )
                } ?: Box(Modifier.fillMaxSize().background(Color.White.copy(alpha = 0.08f)))
            }
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(
                    playarrString(PlayarrString.PlayerUpNext).uppercase(language.locale),
                    color = WebPink,
                    fontSize = 10.sp,
                    fontWeight = FontWeight.ExtraBold,
                )
                if (nextItem.seasonNumber != null && nextItem.episodeNumber != null) {
                    Text(
                        playarrString(
                            PlayarrString.PlayerSeasonEpisodeLabel,
                            "season" to nextItem.seasonNumber.toString().padStart(2, '0'),
                            "episode" to nextItem.episodeNumber.toString().padStart(2, '0'),
                        ),
                        color = Color.White.copy(alpha = 0.66f),
                        fontSize = 12.sp,
                        fontWeight = FontWeight.Bold,
                    )
                }
                Text(
                    nextItem.displayTitle(language),
                    color = Color.White,
                    fontSize = if (isTelevision) 22.sp else 16.sp,
                    fontWeight = FontWeight.SemiBold,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
                nextItem.subtitle?.let {
                    Text(it, color = Color.White.copy(alpha = 0.58f), fontSize = 12.sp, maxLines = 1)
                }
                Row(
                    Modifier.padding(top = 8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    PlayarrEndCardButton(
                        label = playarrString(if (countdown) PlayarrString.EndCardPlayNow else PlayarrString.EndCardPlayNext),
                        icon = Icons.Outlined.PlayArrow,
                        isTelevision = isTelevision,
                        emphasised = true,
                        onClick = { dispatch(PlayarrEndCardEvent.PlayNow) },
                        modifier = Modifier.focusRequester(primaryFocus),
                    )
                    if (countdown) {
                        PlayarrEndCardButton(
                            label = playarrString(PlayarrString.EndCardCancel),
                            isTelevision = isTelevision,
                            onClick = { dispatch(PlayarrEndCardEvent.Cancel) },
                        )
                        Box(
                            Modifier.size(if (isTelevision) 52.dp else 44.dp).clearAndSetSemantics {},
                            contentAlignment = Alignment.Center,
                        ) {
                            CircularProgressIndicator(
                                progress = { state.progress },
                                color = WebPink,
                                trackColor = Color.White.copy(alpha = 0.16f),
                                modifier = Modifier.fillMaxSize(),
                            )
                            Text(
                                state.remainingSeconds.toString(),
                                color = Color.White,
                                fontWeight = FontWeight.Bold,
                                fontSize = if (isTelevision) 18.sp else 15.sp,
                            )
                        }
                        // Plain text carries the value (also the reduced-motion form).
                        Text(
                            playarrString(PlayarrString.EndCardPlayingIn, "seconds" to state.remainingSeconds),
                            color = Color.White.copy(alpha = 0.8f),
                            fontSize = 13.sp,
                            modifier = Modifier.semantics {
                                contentDescription = announced
                                liveRegion = LiveRegionMode.Polite
                            },
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun PlayarrEndCardButton(
    label: String,
    isTelevision: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    icon: androidx.compose.ui.graphics.vector.ImageVector? = null,
    accessibilityLabel: String? = null,
    emphasised: Boolean = false,
) {
    val source = remember { MutableInteractionSource() }
    val focused by source.collectIsFocusedAsState()
    Surface(
        onClick = onClick,
        interactionSource = source,
        color = if (emphasised) Color.White else Color.White.copy(alpha = 0.14f),
        contentColor = if (emphasised) Color.Black else Color.White,
        shape = CircleShape,
        border = if (focused) BorderStroke(3.dp, WebPink) else BorderStroke(1.dp, Color.White.copy(alpha = 0.28f)),
        modifier = modifier
            .height(if (isTelevision) 48.dp else 44.dp)
            .semantics { contentDescription = accessibilityLabel ?: label },
    ) {
        Row(
            Modifier.padding(horizontal = 18.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            icon?.let { Icon(it, contentDescription = null, modifier = Modifier.size(22.dp)) }
            Text(label, fontSize = 14.sp, fontWeight = FontWeight.Bold)
        }
    }
}

@Composable
private fun PlayarrSuggestionTile(
    work: Work,
    isTelevision: Boolean,
    serverUrl: String,
    accessToken: String?,
    onClick: () -> Unit,
) {
    val source = remember { MutableInteractionSource() }
    val focused by source.collectIsFocusedAsState()
    Column(Modifier.width(if (isTelevision) 220.dp else 150.dp)) {
        Surface(
            onClick = onClick,
            interactionSource = source,
            color = WebSurfaceSoft,
            shape = RoundedCornerShape(10.dp),
            modifier = Modifier
                .fillMaxWidth()
                .aspectRatio(16f / 9f)
                .border(if (focused) 3.dp else 0.dp, WebPink, RoundedCornerShape(10.dp))
                .semantics { contentDescription = work.title },
        ) {
            PlayarrSuggestionArtwork(
                work = work,
                serverUrl = serverUrl,
                accessToken = accessToken,
                modifier = Modifier.fillMaxSize(),
            )
        }
        Text(
            work.title,
            color = Color.White,
            fontSize = 12.sp,
            fontWeight = FontWeight.SemiBold,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.padding(top = 7.dp),
        )
    }
}

/**
 * Tile art with fallbacks: walks [playarrArtworkCandidates] (server artwork
 * endpoint then provider URL, per image kind) and moves to the next candidate
 * when a load fails. When nothing is available or every candidate failed, shows
 * a titled placeholder instead of an empty box.
 */
@Composable
private fun PlayarrSuggestionArtwork(
    work: Work,
    serverUrl: String,
    accessToken: String?,
    modifier: Modifier = Modifier,
) {
    val context = LocalContext.current
    val access = rememberPlayarrWorkServerAccess(work.id, serverUrl, accessToken)
    val candidates = remember(work.id, work.images, access?.serverUrl) {
        access?.let { playarrArtworkCandidates(work.id, work.images, PLAYER_SUGGESTION_ARTWORK_KINDS, it.serverUrl) }
            .orEmpty()
    }
    var failed by remember(candidates) { mutableStateOf(0) }
    val url = candidates.getOrNull(failed)
    if (access == null || url == null) {
        Box(modifier.background(WebSurfaceSoft), contentAlignment = Alignment.Center) {
            Text(
                work.title,
                color = Color.White.copy(alpha = 0.85f),
                fontSize = 13.sp,
                fontWeight = FontWeight.SemiBold,
                textAlign = TextAlign.Center,
                maxLines = 3,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.padding(12.dp),
            )
        }
        return
    }
    val token = playarrAccessTokenForUrl(access, url)
    val request = remember(url, token) {
        ImageRequest.Builder(context)
            .data(url)
            .apply {
                if (!token.isNullOrBlank()) {
                    httpHeaders(NetworkHeaders.Builder().set("Authorization", "Bearer $token").build())
                }
            }
            .build()
    }
    AsyncImage(
        model = request,
        contentDescription = work.title,
        contentScale = ContentScale.Crop,
        onError = { failed += 1 },
        modifier = modifier,
    )
}
