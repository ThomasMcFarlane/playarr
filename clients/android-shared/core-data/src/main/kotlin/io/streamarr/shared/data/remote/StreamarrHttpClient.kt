package io.streamarr.shared.data.remote

import io.streamarr.shared.data.model.ClientPlatform
import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonNamingStrategy
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.Interceptor
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.logging.HttpLoggingInterceptor
import com.jakewharton.retrofit2.converter.kotlinx.serialization.asConverterFactory
import retrofit2.Retrofit

/**
 * Builds the shared [Retrofit]/[OkHttpClient] pair every Playarr Android
 * client points at its Streamarr server with. Deliberately a plain factory
 * (not a Hilt `@Module`) so `core-data` stays framework-light -- the app
 * modules' own DI graphs (see `mobile-android`/`tv-android`'s `di/`) call
 * into this and bind the result into their Hilt components.
 */
@OptIn(ExperimentalSerializationApi::class)
object StreamarrHttpClient {

    /**
     * The shared JSON codec: unknown-key-tolerant so an older client
     * survives additive server changes. [JsonNamingStrategy.SnakeCase] is
     * what actually connects this module's idiomatic-camelCase Kotlin
     * models (`Work.sortTitle`, `CatalogPage.total`, ...) to the
     * spec's snake_case wire fields (`sort_title`, `total`, ...)
     * without a `@SerialName` on every single property -- fields that
     * already carry an explicit `@SerialName` (enum wire values,
     * `core-auth`'s hand-annotated OAuth DTOs) are unaffected, since an
     * explicit `@SerialName` always wins over the naming strategy.
     */
    val json: Json = Json {
        ignoreUnknownKeys = true
        encodeDefaults = true
        explicitNulls = false
        namingStrategy = JsonNamingStrategy.SnakeCase
    }

    /**
     * @param baseUrlProvider returns the operator server's current base
     *   URL (e.g. `"http://10.0.2.2:8484"`, see
     *   `io.streamarr.shared.data.config.ServerConfigStore`), re-invoked on
     *   every request via [dynamicBaseUrlInterceptor] so a base-URL change
     *   saved from the Settings screen takes effect on the very next call --
     *   no app restart, no rebuilding this [Retrofit] instance. [Retrofit.Builder.baseUrl]
     *   below is still given a fixed, never-actually-dialled placeholder;
     *   only the scheme/host/port get rewritten per-request, so the path
     *   Retrofit resolved from each `@GET`/`@POST` annotation is preserved
     *   untouched.
     * @param clientPlatform stamped onto every request via `X-Streamarr-Client-Platform`,
     *   matching the header contract `streamarr-model::platform::ClientPlatform::wire_name` documents server-side.
     * @param clientVersion this app build's version name, sent alongside the platform header.
     * @param enableHttpLogging verbose body logging; callers should gate this behind a debug build flag.
     */
    fun create(
        baseUrlProvider: () -> String,
        clientPlatform: ClientPlatform,
        clientVersion: String,
        accessTokenProvider: () -> String? = { null },
        enableHttpLogging: Boolean = false,
    ): StreamarrApi {
        val okHttpClient = OkHttpClient.Builder()
            .addInterceptor(dynamicBaseUrlInterceptor(baseUrlProvider))
            .addInterceptor(platformHeaderInterceptor(clientPlatform, clientVersion))
            .addInterceptor { chain ->
                val token = accessTokenProvider()
                val request = if (token.isNullOrBlank()) chain.request() else chain.request()
                    .newBuilder()
                    .header("Authorization", "Bearer $token")
                    .build()
                chain.proceed(request)
            }
            .apply {
                if (enableHttpLogging) {
                    addInterceptor(HttpLoggingInterceptor().apply { level = HttpLoggingInterceptor.Level.BODY })
                }
            }
            .build()

        val retrofit = Retrofit.Builder()
            .baseUrl(PLACEHOLDER_BASE_URL)
            .client(okHttpClient)
            .addConverterFactory(json.asConverterFactory("application/json".toMediaType()))
            .build()

        return retrofit.create(StreamarrApi::class.java)
    }

    private fun platformHeaderInterceptor(platform: ClientPlatform, version: String): Interceptor =
        Interceptor { chain ->
            val request = chain.request().newBuilder()
                .header("X-Streamarr-Client-Platform", platform.wireName())
                .header("X-Streamarr-Client-Version", version)
                .build()
            chain.proceed(request)
        }

    /** Never actually dialled -- see [create]'s KDoc. Must be a syntactically valid absolute URL for [Retrofit.Builder.baseUrl]. */
    private const val PLACEHOLDER_BASE_URL = "http://streamarr.invalid/"
}

/**
 * Rewrites each outgoing request's scheme/host/port to whatever
 * [baseUrlProvider] currently returns, leaving the path/query Retrofit
 * already resolved from the relative `@GET`/`@POST` path untouched. This is
 * what makes the operator base URL runtime-configurable rather than fixed
 * at [Retrofit] construction time.
 */
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
        // Malformed setting; proceed against the never-reachable placeholder
        // host so the failure surfaces as a normal network error rather
        // than silently succeeding against the wrong server.
        original
    }
    chain.proceed(request)
}

/** The header value this platform is identified by, mirroring `ClientPlatform::wire_name` server-side. */
fun ClientPlatform.wireName(): String = when (this) {
    ClientPlatform.AndroidMobile -> "android-mobile"
    ClientPlatform.AndroidTv -> "android-tv"
    ClientPlatform.Ios -> "ios"
    ClientPlatform.Web -> "web"
    ClientPlatform.TvWebos -> "tv-webos"
    ClientPlatform.TvTizen -> "tv-tizen"
    ClientPlatform.TvVidaa -> "tv-vidaa"
}
