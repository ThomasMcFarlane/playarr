package io.streamarr.shared.auth.remote

import com.jakewharton.retrofit2.converter.kotlinx.serialization.asConverterFactory
import kotlinx.serialization.json.Json
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.Interceptor
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.Retrofit

/**
 * Builds pre-session Retrofit clients ([DeviceAuthApi], [LoginApi]) pointed
 * at a Streamarr server. Separate from `core-data`'s `StreamarrHttpClient`
 * on purpose: device pairing and login both happen before any access token
 * exists, so this client carries no `Authorization` interceptor (there's
 * nothing to attach yet) and has no dependency on `core-data` at all --
 * a television can complete pairing, and any client can log in, with only
 * `core-auth` on its classpath.
 */
object AuthHttpClient {

    /**
     * @param baseUrlProvider returns the operator server's current base
     *   URL, re-invoked on every request (mirrors `StreamarrHttpClient.create`'s
     *   `baseUrlProvider` -- see its KDoc for the placeholder-host +
     *   per-request-rewrite mechanism this uses too, so a base-URL change
     *   from Settings takes effect on the very next pairing request without
     *   an app restart).
     */
    fun create(baseUrlProvider: () -> String, enableHttpLogging: Boolean = false): DeviceAuthApi =
        buildRetrofit(baseUrlProvider, enableHttpLogging).create(DeviceAuthApi::class.java)

    /**
     * Same underlying client as [create] (no `Authorization` interceptor,
     * same base-URL rewriting), pointed at `POST /api/v1/auth/login`
     * instead -- see [LoginApi] and
     * [io.streamarr.shared.auth.SessionManager].
     */
    fun createLoginApi(baseUrlProvider: () -> String, enableHttpLogging: Boolean = false): LoginApi =
        buildRetrofit(baseUrlProvider, enableHttpLogging).create(LoginApi::class.java)

    /** Builds the unauthenticated client used to rotate a persisted refresh token. */
    fun createRefreshApi(baseUrlProvider: () -> String, enableHttpLogging: Boolean = false): RefreshApi =
        buildRetrofit(baseUrlProvider, enableHttpLogging).create(RefreshApi::class.java)

    /** Fixed-origin client for the short-lived playarr.app first-contact broker. */
    fun createHostedDeviceLinkApi(enableHttpLogging: Boolean = false): HostedDeviceLinkApi =
        buildRetrofit({ PLAYARR_BASE_URL }, enableHttpLogging).create(HostedDeviceLinkApi::class.java)

    private fun buildRetrofit(baseUrlProvider: () -> String, enableHttpLogging: Boolean): Retrofit {
        val json = Json { ignoreUnknownKeys = true }

        val okHttpClient = OkHttpClient.Builder()
            .addInterceptor(dynamicBaseUrlInterceptor(baseUrlProvider))
            .apply {
                if (enableHttpLogging) {
                    addInterceptor(HttpLoggingInterceptor().apply { level = HttpLoggingInterceptor.Level.BODY })
                }
            }
            .build()

        return Retrofit.Builder()
            .baseUrl(PLACEHOLDER_BASE_URL)
            .client(okHttpClient)
            .addConverterFactory(json.asConverterFactory("application/json".toMediaType()))
            .build()
    }

    /** Never actually dialled -- see [create]'s KDoc. Must be a syntactically valid absolute URL for [Retrofit.Builder.baseUrl]. */
    private const val PLACEHOLDER_BASE_URL = "http://streamarr.invalid/"
    private const val PLAYARR_BASE_URL = "https://playarr.app/"
}

/** See `io.streamarr.shared.data.remote`'s identical private helper -- duplicated rather than shared to keep this module core-data-free. */
private fun dynamicBaseUrlInterceptor(baseUrlProvider: () -> String): Interceptor = Interceptor { chain ->
    val original = chain.request()
    val configured = baseUrlProvider().trim().toHttpUrlOrNull()
    val request = if (configured != null) {
        val rewrittenUrl = original.url.newBuilder()
            .scheme(configured.scheme)
            .host(configured.host)
            .port(configured.port)
            .build()
        original.newBuilder().url(rewrittenUrl).build()
    } else {
        original
    }
    chain.proceed(request)
}
