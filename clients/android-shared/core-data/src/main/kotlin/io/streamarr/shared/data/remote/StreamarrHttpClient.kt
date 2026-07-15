package io.streamarr.shared.data.remote

import io.streamarr.shared.data.model.ClientPlatform
import kotlinx.serialization.json.Json
import okhttp3.Interceptor
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.logging.HttpLoggingInterceptor
import com.jakewharton.retrofit2.converter.kotlinx.serialization.asConverterFactory
import retrofit2.Retrofit

/**
 * Builds the shared [Retrofit]/[OkHttpClient] pair every Playarr Android
 * client points at its Streamarr server with. Deliberately a plain factory
 * (not a Hilt `@Module`) so `core-data` stays framework-light — the app
 * modules' own DI graphs (see `mobile-android`/`di`, `tv-android`/`di`)
 * call into this and bind the result into their Hilt components.
 */
object StreamarrHttpClient {

    /** The shared JSON codec: unknown-key-tolerant so an older client survives additive server changes. */
    val json: Json = Json {
        ignoreUnknownKeys = true
        encodeDefaults = true
        explicitNulls = false
    }

    /**
     * @param baseUrl e.g. `"https://streamarr.example.com/"` (must end in `/`).
     * @param clientPlatform stamped onto every request via `X-Streamarr-Client-Platform`,
     *   matching the header contract `streamarr-model::platform::ClientPlatform::wire_name` documents server-side.
     * @param clientVersion this app build's version name, sent alongside the platform header.
     * @param accessTokenProvider returns the current bearer token, or `null` when signed out /
     *   mid device-pairing; re-invoked on every request so a refreshed token is picked up
     *   without rebuilding the client.
     * @param enableHttpLogging verbose body logging; callers should gate this behind a debug build flag.
     */
    fun create(
        baseUrl: String,
        clientPlatform: ClientPlatform,
        clientVersion: String,
        accessTokenProvider: () -> String?,
        enableHttpLogging: Boolean = false,
    ): StreamarrApi {
        val okHttpClient = OkHttpClient.Builder()
            .addInterceptor(platformHeaderInterceptor(clientPlatform, clientVersion))
            .addInterceptor(authorizationInterceptor(accessTokenProvider))
            .apply {
                if (enableHttpLogging) {
                    addInterceptor(HttpLoggingInterceptor().apply { level = HttpLoggingInterceptor.Level.BODY })
                }
            }
            .build()

        val retrofit = Retrofit.Builder()
            .baseUrl(baseUrl)
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

    private fun authorizationInterceptor(accessTokenProvider: () -> String?): Interceptor =
        Interceptor { chain ->
            val token = accessTokenProvider()
            val request = if (token != null) {
                chain.request().newBuilder().header("Authorization", "Bearer $token").build()
            } else {
                chain.request()
            }
            chain.proceed(request)
        }
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
