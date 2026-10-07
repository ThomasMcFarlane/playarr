package io.playarr.mobile.ui

/** How long a start may sit buffering with no frame played before it counts as stalled. */
internal const val PLAYER_START_STALL_TIMEOUT_MS = 25_000L

/** Backoff between automatic retries after an error or stalled start; once exhausted the in-player error shows. */
internal val PLAYER_AUTO_RETRY_DELAYS_MS: List<Long> = listOf(1_500L, 3_000L, 6_000L)

internal fun playarrAutoRetryDelayMs(attemptsSoFar: Int): Long? = PLAYER_AUTO_RETRY_DELAYS_MS.getOrNull(attemptsSoFar)

/** Phone double-tap seek step (left half back, right half forward). */
internal const val PLAYER_DOUBLE_TAP_SEEK_MS = 10_000L

internal fun playarrDoubleTapSeekDeltaMs(tapX: Float, width: Float): Long =
    if (tapX < width / 2f) -PLAYER_DOUBLE_TAP_SEEK_MS else PLAYER_DOUBLE_TAP_SEEK_MS

/** How long the "converted stream" notice stays on screen. */
internal const val PLAYER_NOTICE_MS = 6_000L
