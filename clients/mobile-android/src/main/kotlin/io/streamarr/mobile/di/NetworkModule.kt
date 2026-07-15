package io.streamarr.mobile.di

import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import io.streamarr.mobile.BuildConfig
import io.streamarr.shared.auth.TokenStore
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
    fun provideStreamarrApi(tokenStore: TokenStore): StreamarrApi = StreamarrHttpClient.create(
        baseUrl = BuildConfig.STREAMARR_BASE_URL,
        clientPlatform = ClientPlatform.AndroidMobile,
        clientVersion = BuildConfig.VERSION_NAME,
        // The OkHttp interceptor that reads this runs off the main thread
        // (OkHttp's own dispatcher), so blocking here for the latest
        // DataStore value is acceptable; it must not suspend since
        // OkHttp's Interceptor chain is synchronous.
        accessTokenProvider = { runBlocking { tokenStore.accessToken.first() } },
        enableHttpLogging = BuildConfig.DEBUG,
    )
}
