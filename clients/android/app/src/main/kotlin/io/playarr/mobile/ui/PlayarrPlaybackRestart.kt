package io.playarr.mobile.ui

/** Identity of a `play()` request, used to tell a genuine new item from a re-delivered one. */
internal data class PlayarrPlayRequest(
    val mediaFileId: String,
    val requestedStartPositionMs: Long?,
    val launchSettings: PlayarrPlaybackLaunchSettings?,
)

/**
 * Whether a `play()` call must (re)prepare the player. A request identical to
 * the one already playing is only ever a re-delivery (the activity was
 * recreated on a display / configuration change and its `LaunchedEffect`
 * ran again, or the player defaults object changed), and re-preparing would
 * discard the buffer and seek back to a stale resume position. Ended or
 * failed playback, an explicit retry, and any different request restart.
 */
internal fun shouldRestartPlayarrPlayback(
    active: PlayarrPlayRequest?,
    requested: PlayarrPlayRequest,
    hasEnded: Boolean,
    hasFailed: Boolean,
    force: Boolean,
): Boolean = force || active != requested || hasEnded || hasFailed
