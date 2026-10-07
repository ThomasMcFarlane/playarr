package io.playarr.mobile.ui

import coil3.ImageLoader
import coil3.PlatformContext
import coil3.intercept.Interceptor
import coil3.network.okhttp.OkHttpNetworkFetcherFactory
import coil3.EventListener
import coil3.request.ErrorResult
import coil3.request.ImageRequest
import coil3.request.SuccessResult
import coil3.request.crossfade
import coil3.request.ImageResult
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import kotlinx.coroutines.delay
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withPermit
import okhttp3.OkHttpClient

/**
 * Frame thumbnails (`/api/v1/media/{id}/thumbnail`) are produced on demand by an
 * ffmpeg process on the server (about 0.5 GiB each on a UHD remux). A chapter rail
 * asks for a dozen at once; four in parallel exhausted a 2 GiB server pod and the
 * kernel killed the whole server, which left every tile blank. Keep at most this many
 * in flight from the client regardless of server-side limits.
 */
internal const val PLAYARR_FRAME_THUMBNAIL_CONCURRENCY = 2

/** Frame thumbnails may legitimately take 10+ s to extract on a cold UHD file. */
private const val IMAGE_READ_TIMEOUT_SECONDS = 45L
private const val IMAGE_CONNECT_TIMEOUT_SECONDS = 20L
private const val FRAME_THUMBNAIL_RETRY_DELAY_MS = 1_500L

/** True for `.../api/v1/media/{id}/thumbnail[?position_ms=...]`. */
internal fun isPlayarrFrameThumbnailUrl(data: Any?): Boolean {
    val url = data as? String ?: return false
    val path = url.substringBefore('?').substringBefore('#')
    return Regex("/api/v1/media/[^/]+/thumbnail$").containsMatchIn(path)
}

/** Bounds concurrent frame-thumbnail loads and retries a failed one once. */
internal class PlayarrFrameThumbnailGate(
    limit: Int = PLAYARR_FRAME_THUMBNAIL_CONCURRENCY,
    private val retryDelayMs: Long = FRAME_THUMBNAIL_RETRY_DELAY_MS,
) {
    private val permits = Semaphore(limit)

    suspend fun <R> run(failed: (R) -> Boolean, block: suspend () -> R): R = permits.withPermit {
        val first = block()
        if (!failed(first)) return@withPermit first
        delay(retryDelayMs)
        block()
    }
}

internal class PlayarrFrameThumbnailInterceptor(
    private val gate: PlayarrFrameThumbnailGate = PlayarrFrameThumbnailGate(),
) : Interceptor {
    override suspend fun intercept(chain: Interceptor.Chain): ImageResult {
        if (!isPlayarrFrameThumbnailUrl(chain.request.data)) return chain.proceed()
        return gate.run(failed = { it is ErrorResult }) { chain.proceed() }
    }
}

/** The app-wide Coil loader: generous timeouts and bounded frame-thumbnail concurrency. */
internal fun newPlayarrImageLoader(context: PlatformContext): ImageLoader {
    val client = OkHttpClient.Builder()
        .connectTimeout(IMAGE_CONNECT_TIMEOUT_SECONDS, TimeUnit.SECONDS)
        .readTimeout(IMAGE_READ_TIMEOUT_SECONDS, TimeUnit.SECONDS)
        .build()
    val parity = isParityCaptureBuild(context)
    return ImageLoader.Builder(context)
        .apply {
            if (parity) {
                // Debug builds only: pixel-parity captures wait for this signal instead of guessing a settle time.
                crossfade(false)
                eventListenerFactory(EventListener.Factory { PlayarrParityImageCounter })
            }
        }
        .components {
            add(OkHttpNetworkFetcherFactory(callFactory = { client }))
            add(PlayarrFrameThumbnailInterceptor())
        }
        .build()
}


private fun isParityCaptureBuild(context: PlatformContext): Boolean =
    (context.applicationInfo.flags and android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) != 0

/**
 * Counts in-flight image requests and logs every change as `PlayarrParity images inflight=N failed=M`
 * (tag `PlayarrParity`), so a capture script can wait for `inflight=0` after the screen settles.
 * Only installed by [newPlayarrImageLoader] in debuggable builds.
 */
internal object PlayarrParityImageCounter : EventListener() {
    private val inFlight = AtomicInteger(0)
    private val failed = AtomicInteger(0)

    override fun onStart(request: ImageRequest) = report(inFlight.incrementAndGet())
    override fun onSuccess(request: ImageRequest, result: SuccessResult) = report(inFlight.decrementAndGet())
    override fun onCancel(request: ImageRequest) = report(inFlight.decrementAndGet())
    override fun onError(request: ImageRequest, result: ErrorResult) {
        failed.incrementAndGet()
        report(inFlight.decrementAndGet())
    }

    internal fun inFlightCount(): Int = inFlight.get()
    internal fun failedCount(): Int = failed.get()
    internal fun reset() { inFlight.set(0); failed.set(0) }

    private fun report(now: Int) {
        runCatching { android.util.Log.i("PlayarrParity", "images inflight=$now failed=${failed.get()}") }
    }
}
