package io.streamarr.mobile.di

import android.os.Build
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import io.streamarr.mobile.BuildConfig
import io.streamarr.shared.auth.SessionManager
import io.streamarr.shared.data.config.ServerConfigStore
import io.streamarr.shared.data.model.ClientPlatform
import io.streamarr.shared.data.remote.StreamarrApi
import io.streamarr.shared.data.remote.StreamarrHttpClient
import javax.inject.Singleton
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import io.streamarr.shared.auth.model.ClientPlatform as AuthClientPlatform

/**
 * Wires `core-data`'s framework-agnostic [StreamarrHttpClient] factory
 * into Hilt. Kept as a plain `@Provides` function (not `@Binds`) because
 * [StreamarrApi] is built by a factory, not directly `@Inject`-constructed.
 */
@Module
@InstallIn(SingletonComponent::class)
object NetworkModule {

    @Provides
    @Singleton
    fun provideStreamarrApi(sessionManager: SessionManager, serverConfigStore: ServerConfigStore): StreamarrApi = StreamarrHttpClient.create(
        // Re-invoked on every request (see StreamarrHttpClient.create's
        // KDoc), so a base URL saved from the Settings screen takes effect
        // immediately -- no need to rebuild this Retrofit instance.
        baseUrlProvider = { runBlocking { serverConfigStore.baseUrl.first() } },
        clientPlatform = ClientPlatform.AndroidMobile,
        clientVersion = BuildConfig.VERSION_NAME,
        // Only invoked by StreamarrHttpClient for the requests
        // submit/approve/reject calls (see `requiresBearerAuth`), so the
        // transparent login this can trigger is never paid for by
        // catalog/playback browsing. The OkHttp interceptor that reads
        // this runs off the main thread (OkHttp's own dispatcher), so
        // blocking here -- for the latest stored token, or for a real
        // network round trip to `POST /api/v1/auth/login` when there
        // isn't one yet -- is acceptable; it must not suspend since
        // OkHttp's Interceptor chain is synchronous.
        accessTokenProvider = {
            runBlocking {
                sessionManager.ensureAccessToken(
                    clientPlatform = AuthClientPlatform.AndroidMobile,
                    clientVersion = BuildConfig.VERSION_NAME,
                    deviceName = Build.MODEL ?: "Android",
                )
            }
        },
        enableHttpLogging = BuildConfig.DEBUG,
    )
}
