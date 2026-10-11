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

/** Source-timeline duration: the negotiated source duration when known, else the engine window shifted by the source offset. */
internal fun playarrSourceDurationMs(negotiatedDurationMs: Long, engineDurationMs: Long, sourceOffsetMs: Long): Long =
    negotiatedDurationMs.takeIf { it > 0L }
        ?: engineDurationMs.coerceAtLeast(0L).let { if (it > 0L) it + sourceOffsetMs.coerceAtLeast(0L) else 0L }

internal fun isPlayarrOnDemandHls(playbackUrl: String): Boolean =
    playbackUrl.contains("/api/v1/media/sessions/")

internal fun shouldRecoverPlayarrHlsSession(
    activeOnDemandHls: Boolean,
    httpStatus: Int?,
    requestUri: String?,
): Boolean = activeOnDemandHls && httpStatus == 404 && requestUri?.let(::isPlayarrOnDemandHls) == true

internal const val DECODE_FALLBACK_PROFILE = "h264-1080p-8mbps"

/** Direct play, or an original-quality HLS session whose video the server copied; a forced transcode is not. */
internal fun playarrPlaysSourceVideo(activeDirectPlay: Boolean, activeQualityId: String?): Boolean =
    activeDirectPlay || activeQualityId == "original"

/**
 * A session that plays the source video ([playarrPlaysSourceVideo]) that no
 * device decoder can handle should be retried once as a server transcode. A
 * forced transcode is excluded: it already is the converted stream.
 * [errorMessage] is the player's error code name.
 */
internal fun shouldFallBackToTranscodeAfterDecodeFailure(
    playsSourceVideo: Boolean,
    errorMessage: String,
    alreadyAttempted: Boolean,
): Boolean = playsSourceVideo && !alreadyAttempted && errorMessage.uppercase() in setOf(
    "ERROR_CODE_DECODING_FAILED",
    "ERROR_CODE_DECODING_FORMAT_EXCEEDS_CAPABILITIES",
    "ERROR_CODE_DECODING_FORMAT_UNSUPPORTED",
    "ERROR_CODE_DECODER_INIT_FAILED",
    "ERROR_CODE_DECODER_QUERY_FAILED",
)

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
