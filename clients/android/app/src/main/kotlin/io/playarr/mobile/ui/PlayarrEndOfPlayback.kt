package io.playarr.mobile.ui

/**
 * End-of-playback experience: pure state machine (no Compose/Android types) so
 * it can be unit tested on the JVM. The overlay in
 * `PlayarrEndOfPlaybackOverlay.kt` renders [PlayarrEndCardState] and feeds
 * user/timer input back through [reducePlayarrEndCard].
 *
 * Trigger: `PlaybackState.hasEnded` (Media3 STATE_ENDED) only. The server API
 * exposes chapters but no credits/outro markers, so there is no early
 * "credits" trigger.
 */

/** Length of the "Up next" countdown. */
internal const val PLAYER_UP_NEXT_COUNTDOWN_MS = 10_000L

/** Countdown resolution. */
internal const val PLAYER_UP_NEXT_TICK_MS = 100L

/**
 * docs/architecture/end-of-playback.md section 4: moving focus onto the
 * suggestions row must not stop the countdown, only an explicit action does.
 * The reducer still supports pausing; flip this to restore it.
 */
internal const val PLAYER_UP_NEXT_PAUSE_ON_BROWSE = false

/** Plain ended card releases keep-awake after this long (spec section 10). */
internal const val PLAYER_END_CARD_KEEP_AWAKE_MS = 60_000L

/** Suggestions row cap (spec section 5). */
internal const val PLAYER_SUGGESTION_LIMIT = 12

/** Start suggestion prefetch when this close to the end (or ended). */
internal const val PLAYER_SUGGESTION_PREFETCH_MS = 90_000L

internal enum class PlayarrEndCardMode {
    Hidden,

    /** Finished, nothing queued next: Replay / Exit / suggestions. */
    Standalone,

    /** Next queue item is counting down to auto-play. */
    Countdown,

}

internal data class PlayarrEndCardState(
    val mode: PlayarrEndCardMode = PlayarrEndCardMode.Hidden,
    val remainingMs: Long = 0L,
    /** True while the viewer is browsing suggestions (focus or scroll). */
    val paused: Boolean = false,
) {
    val visible: Boolean get() = mode != PlayarrEndCardMode.Hidden
    val counting: Boolean get() = mode == PlayarrEndCardMode.Countdown && !paused
    val hasNext: Boolean get() = mode == PlayarrEndCardMode.Countdown
    val remainingSeconds: Int get() = ((remainingMs + 999L) / 1_000L).toInt()
    val progress: Float
        get() = (remainingMs.toFloat() / PLAYER_UP_NEXT_COUNTDOWN_MS).coerceIn(0f, 1f)
}

internal sealed interface PlayarrEndCardEvent {
    /** Playback reached STATE_ENDED. */
    data class Ended(val hasNext: Boolean) : PlayarrEndCardEvent

    /** Playback is no longer ended (new item or replay started). */
    data object Reset : PlayarrEndCardEvent
    data class Tick(val elapsedMs: Long) : PlayarrEndCardEvent
    data object Cancel : PlayarrEndCardEvent
    data object PlayNow : PlayarrEndCardEvent
    data object Replay : PlayarrEndCardEvent
    data object Exit : PlayarrEndCardEvent
    data class SelectSuggestion(val workId: String) : PlayarrEndCardEvent
    data class BrowsingSuggestions(val browsing: Boolean) : PlayarrEndCardEvent
}

/** Side effect the host must perform after a transition. */
internal sealed interface PlayarrEndCardEffect {
    data object None : PlayarrEndCardEffect
    data object AdvanceAutomatically : PlayarrEndCardEffect
    data object AdvanceNow : PlayarrEndCardEffect
    data object Replay : PlayarrEndCardEffect
    data object Exit : PlayarrEndCardEffect
    data class OpenSuggestion(val workId: String) : PlayarrEndCardEffect
}

internal fun reducePlayarrEndCard(
    state: PlayarrEndCardState,
    event: PlayarrEndCardEvent,
): Pair<PlayarrEndCardState, PlayarrEndCardEffect> {
    val none = PlayarrEndCardEffect.None
    val hidden = PlayarrEndCardState()
    return when (event) {
        is PlayarrEndCardEvent.Ended ->
            if (state.visible) {
                state to none
            } else if (event.hasNext) {
                PlayarrEndCardState(PlayarrEndCardMode.Countdown, PLAYER_UP_NEXT_COUNTDOWN_MS) to none
            } else {
                PlayarrEndCardState(PlayarrEndCardMode.Standalone) to none
            }
        PlayarrEndCardEvent.Reset -> hidden to none
        is PlayarrEndCardEvent.Tick ->
            if (!state.counting) {
                state to none
            } else {
                val remaining = (state.remainingMs - event.elapsedMs).coerceAtLeast(0L)
                if (remaining == 0L) hidden to PlayarrEndCardEffect.AdvanceAutomatically
                else state.copy(remainingMs = remaining) to none
            }
        PlayarrEndCardEvent.Cancel ->
            if (state.mode == PlayarrEndCardMode.Countdown) {
                // Sticky: back to the plain ended card for the finished item.
                PlayarrEndCardState(PlayarrEndCardMode.Standalone) to none
            } else {
                state to none
            }
        PlayarrEndCardEvent.PlayNow ->
            if (state.hasNext) hidden to PlayarrEndCardEffect.AdvanceNow else state to none
        PlayarrEndCardEvent.Replay ->
            if (state.visible) hidden to PlayarrEndCardEffect.Replay else state to none
        PlayarrEndCardEvent.Exit ->
            if (state.visible) hidden to PlayarrEndCardEffect.Exit else state to none
        is PlayarrEndCardEvent.SelectSuggestion ->
            if (state.visible) hidden to PlayarrEndCardEffect.OpenSuggestion(event.workId) else state to none
        is PlayarrEndCardEvent.BrowsingSuggestions ->
            if (state.visible && state.paused != event.browsing) {
                state.copy(paused = event.browsing) to none
            } else {
                state to none
            }
    }
}

/** `action` value for `event=end_screen_action`, or null when not logged (auto has its own event). */
internal fun playarrEndCardActionName(effect: PlayarrEndCardEffect): String? = when (effect) {
    PlayarrEndCardEffect.AdvanceNow -> "play_now"
    PlayarrEndCardEffect.Replay -> "replay"
    PlayarrEndCardEffect.Exit -> "exit"
    is PlayarrEndCardEffect.OpenSuggestion -> "suggestion"
    PlayarrEndCardEffect.AdvanceAutomatically, PlayarrEndCardEffect.None -> null
}

internal fun playarrEndCardKind(state: PlayarrEndCardState): String = if (state.hasNext) "up_next" else "ended"

internal fun playarrEndScreenShownLogLine(state: PlayarrEndCardState, mediaFileId: String?, suggestions: Int): String =
    "event=end_screen_shown kind=${playarrEndCardKind(state)} has_suggestions=${suggestions > 0} " +
        "media_file_id=${mediaFileId.orEmpty()}"

internal fun playarrEndScreenActionLogLine(action: String, kind: String, mediaFileId: String?): String =
    "event=end_screen_action action=$action kind=$kind media_file_id=${mediaFileId.orEmpty()}"

internal fun playarrEndScreenAutoplayLogLine(mediaFileId: String?): String =
    "event=end_screen_autoplay media_file_id=${mediaFileId.orEmpty()}"

/**
 * Whether the end card applies: local video only, no playback error. Music
 * keeps its existing silent auto-advance and casting leaves the card to the
 * receiver.
 */
internal fun shouldShowPlayarrEndCard(item: PlayarrPlaybackQueueItem?, casting: Boolean, hasError: Boolean = false): Boolean =
    item != null && !item.music && !casting && !hasError

/** Keep-awake while the card or countdown is up; released after idling on the plain ended card. */
internal fun shouldHoldScreenForEndCard(state: PlayarrEndCardState, idleExpired: Boolean): Boolean =
    state.visible && (state.hasNext || !idleExpired)

/**
 * Ordered image URLs to try for a 16:9 suggestion tile. Kinds are walked in
 * priority order (backdrop, thumb, poster, banner); for each kind the Playarr
 * Server artwork endpoint (`/api/v1/artwork/work/{id}/{kind}`, the same source
 * web uses: server-cached, authenticated, never hot-linked) comes before the
 * raw provider URL, so one provider that rejects or times out on a TV does not
 * leave the tile empty. Kinds the work has no image for are skipped.
 */
internal fun playarrArtworkCandidates(
    workId: String,
    images: List<io.playarr.shared.data.model.ImageAsset>,
    kinds: List<io.playarr.shared.data.model.ImageKind>,
    serverUrl: String,
): List<String> = kinds.distinct().flatMap { kind ->
    val image = images.firstOrNull { it.kind == kind && it.url.isNotBlank() } ?: return@flatMap emptyList()
    val wireKind = when (kind) {
        io.playarr.shared.data.model.ImageKind.Poster -> "poster"
        io.playarr.shared.data.model.ImageKind.Backdrop -> "backdrop"
        io.playarr.shared.data.model.ImageKind.Banner -> "banner"
        io.playarr.shared.data.model.ImageKind.Logo -> "logo"
        io.playarr.shared.data.model.ImageKind.Thumb -> "thumb"
    }
    listOf(
        "${serverUrl.trimEnd('/')}/api/v1/artwork/work/${workId.asUrlPathSegment()}/$wireKind",
        resolveArtworkUrl(serverUrl, image.url),
    )
}.distinct()

/** Suggestion tiles are 16:9: prefer landscape art, then portrait, then banner. */
internal val PLAYER_SUGGESTION_ARTWORK_KINDS = listOf(
    io.playarr.shared.data.model.ImageKind.Backdrop,
    io.playarr.shared.data.model.ImageKind.Thumb,
    io.playarr.shared.data.model.ImageKind.Poster,
    io.playarr.shared.data.model.ImageKind.Banner,
)

/**
 * A prewarmed playback negotiation is reusable only for the same media file at
 * the same resume position and when the play request carries no custom launch
 * settings (quality/audio overrides negotiate differently).
 */
internal fun playarrPrewarmUsable(
    prewarmedMediaFileId: String,
    prewarmedResumeMs: Long,
    mediaFileId: String,
    resumeMs: Long,
    hasLaunchSettings: Boolean,
): Boolean = !hasLaunchSettings && prewarmedMediaFileId == mediaFileId && prewarmedResumeMs == resumeMs
