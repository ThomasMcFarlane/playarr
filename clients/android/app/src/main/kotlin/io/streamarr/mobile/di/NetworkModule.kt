package io.streamarr.mobile.di

import android.content.Context
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import io.streamarr.mobile.BuildConfig
import io.streamarr.mobile.isTelevision
import io.streamarr.shared.auth.SessionRefresher
import io.streamarr.shared.auth.TokenStore
import io.streamarr.shared.data.config.ServerConfigStore
import io.streamarr.shared.data.model.ClientPlatform
import io.streamarr.shared.data.remote.StreamarrApi
import io.streamarr.shared.data.remote.StreamarrHttpClient
import javax.inject.Singleton
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking

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
    fun provideStreamarrApi(
        @ApplicationContext context: Context,
        serverConfigStore: ServerConfigStore,
        tokenStore: TokenStore,
        sessionRefresher: SessionRefresher,
    ): StreamarrApi = StreamarrHttpClient.create(
        // Re-invoked on every request (see StreamarrHttpClient.create's
        // KDoc), so a base URL saved from the Settings screen takes effect
        // immediately -- no need to rebuild this Retrofit instance.
        baseUrlProvider = { runBlocking { serverConfigStore.baseUrl.first() } },
        clientPlatform = if (isTelevision(context)) {
            ClientPlatform.AndroidTv
        } else {
            ClientPlatform.AndroidMobile
        },
        clientVersion = BuildConfig.VERSION_NAME,
        accessTokenProvider = { runBlocking { tokenStore.accessToken.first() } },
        refreshAccessToken = { rejectedToken ->
            runBlocking { sessionRefresher.refreshAccessToken(rejectedToken) }
        },
        // Access tokens and private catalogue responses must not reach logcat.
        enableHttpLogging = false,
    )
}
