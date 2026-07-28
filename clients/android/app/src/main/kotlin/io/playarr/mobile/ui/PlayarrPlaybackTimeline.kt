package io.playarr.mobile.ui

internal data class PlayarrPlayerTimeline(
    val positionMs: Long = 0L,
    val durationMs: Long = 0L,
    val bufferedPositionMs: Long = 0L,
)

internal fun playarrEnginePositionMs(sourcePositionMs: Long, sourceOffsetMs: Long): Long =
    (sourcePositionMs - sourceOffsetMs).coerceAtLeast(0L)

internal fun playarrSourcePositionMs(
    enginePositionMs: Long,
    sourceOffsetMs: Long,
    sourceDurationMs: Long,
): Long = (enginePositionMs.coerceAtLeast(0L) + sourceOffsetMs.coerceAtLeast(0L))
    .let { absolute ->
        if (sourceDurationMs > 0L) absolute.coerceAtMost(sourceDurationMs) else absolute
    }

internal fun isPlayarrOnDemandHls(playbackUrl: String): Boolean =
    playbackUrl.contains("/api/v1/media/sessions/")

internal fun shouldRecoverPlayarrHlsSession(
    activeOnDemandHls: Boolean,
    httpStatus: Int?,
    requestUri: String?,
): Boolean = activeOnDemandHls && httpStatus == 404 && requestUri?.let(::isPlayarrOnDemandHls) == true

internal fun formatPlayarrPlayerTime(totalMs: Long): String {
    val totalSeconds = totalMs.coerceAtLeast(0L) / 1_000L
    val hours = totalSeconds / 3_600L
    val minutes = (totalSeconds % 3_600L) / 60L
    val seconds = totalSeconds % 60L
    val paddedSeconds = seconds.toString().padStart(2, '0')
    if (hours == 0L) return "$minutes:$paddedSeconds"
    return "$hours:${minutes.toString().padStart(2, '0')}:$paddedSeconds"
}

internal fun playarrPlaybackProgress(positionMs: Long, durationMs: Long): Float {
    if (durationMs <= 0L) return 0f
    return (positionMs.toDouble() / durationMs.toDouble()).coerceIn(0.0, 1.0).toFloat()
}
