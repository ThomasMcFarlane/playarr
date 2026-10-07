package io.playarr.mobile.ui

/**
 * Whether a watch-progress write is allowed. Closing the player while it is still buffering (the
 * decoder never produced a frame, or a source switch has not landed) must not overwrite the stored
 * resume point with the position 0 the engine reports; that lost the user's place. Only a session
 * that actually played, or a completed one, may write.
 */
internal fun shouldPersistPlayarrProgress(
    positionMs: Long,
    playbackReached: Boolean,
    sourceSwitching: Boolean,
    completed: Boolean,
): Boolean = when {
    completed -> true
    !playbackReached -> false
    sourceSwitching && positionMs <= 0L -> false
    else -> positionMs >= 0L
}
