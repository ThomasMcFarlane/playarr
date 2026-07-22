package io.streamarr.mobile.ui

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
