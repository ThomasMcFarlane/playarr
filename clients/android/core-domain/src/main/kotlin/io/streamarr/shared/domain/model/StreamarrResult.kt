package io.streamarr.shared.domain.model

import java.io.IOException
import retrofit2.HttpException

/**
 * Thin result wrapper every use case in this module returns instead of
 * throwing, so UI layers (mobile and TV alike) get one consistent way to
 * branch on network/server failure without each screen writing its own
 * try/catch around Retrofit calls.
 */
sealed interface StreamarrResult<out T> {
    data class Success<T>(val value: T) : StreamarrResult<T>
    data class Failure(val error: StreamarrError) : StreamarrResult<Nothing>
}

sealed interface StreamarrError {
    /** No network path to the server at all (airplane mode, DNS failure, connect timeout, ...). */
    data class Network(val cause: IOException) : StreamarrError

    /** The server answered with a non-2xx HTTP status. */
    data class Http(val code: Int, val cause: HttpException) : StreamarrError

    /** Anything else (decoding failure, programmer error surfaced at the boundary, ...). */
    data class Unknown(val cause: Throwable) : StreamarrError
}

/** Runs [block], mapping any thrown exception into a [StreamarrResult.Failure] rather than propagating it. */
suspend fun <T> runCatchingStreamarr(block: suspend () -> T): StreamarrResult<T> = try {
    StreamarrResult.Success(block())
} catch (e: HttpException) {
    StreamarrResult.Failure(StreamarrError.Http(e.code(), e))
} catch (e: IOException) {
    StreamarrResult.Failure(StreamarrError.Network(e))
} catch (e: Exception) {
    StreamarrResult.Failure(StreamarrError.Unknown(e))
}
