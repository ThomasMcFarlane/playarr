package io.playarr.shared.domain.model

import java.io.IOException
import retrofit2.HttpException

/**
 * Thin result wrapper every use case in this module returns instead of
 * throwing, so UI layers (mobile and TV alike) get one consistent way to
 * branch on network/server failure without each screen writing its own
 * try/catch around Retrofit calls.
 */
sealed interface PlayarrResult<out T> {
    data class Success<T>(val value: T) : PlayarrResult<T>
    data class Failure(val error: PlayarrError) : PlayarrResult<Nothing>
}

sealed interface PlayarrError {
    /** No network path to the server at all (airplane mode, DNS failure, connect timeout, ...). */
    data class Network(val cause: IOException) : PlayarrError

    /** The server answered with a non-2xx HTTP status. */
    data class Http(val code: Int, val cause: HttpException) : PlayarrError

    /** Anything else (decoding failure, programmer error surfaced at the boundary, ...). */
    data class Unknown(val cause: Throwable) : PlayarrError
}

/** Runs [block], mapping any thrown exception into a [PlayarrResult.Failure] rather than propagating it. */
suspend fun <T> runCatchingPlayarr(block: suspend () -> T): PlayarrResult<T> = try {
    PlayarrResult.Success(block())
} catch (e: HttpException) {
    PlayarrResult.Failure(PlayarrError.Http(e.code(), e))
} catch (e: IOException) {
    PlayarrResult.Failure(PlayarrError.Network(e))
} catch (e: Exception) {
    PlayarrResult.Failure(PlayarrError.Unknown(e))
}

/**
 * [runCatchingPlayarr] that retries [PlayarrError.Network] failures (connect/read timeout, TLS or
 * DNS hiccup on a cold connection) up to [attempts] times in total, waiting [backoffMs] between
 * tries (the last entry repeats). HTTP and other errors are returned at once. Only for idempotent
 * reads: a timed-out request may still have reached the server.
 */
suspend fun <T> runCatchingPlayarrRetrying(
    attempts: Int = 3,
    backoffMs: List<Long> = listOf(400L, 1_200L),
    block: suspend () -> T,
): PlayarrResult<T> {
    var result = runCatchingPlayarr(block)
    var tried = 1
    while (tried < attempts && result is PlayarrResult.Failure && result.error is PlayarrError.Network) {
        val wait = backoffMs.getOrElse(tried - 1) { backoffMs.lastOrNull() ?: 0L }
        if (wait > 0L) kotlinx.coroutines.delay(wait)
        result = runCatchingPlayarr(block)
        tried++
    }
    return result
}
