package io.streamarr.mobile.di

import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import io.streamarr.mobile.BuildConfig
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
    fun provideStreamarrApi(serverConfigStore: ServerConfigStore): StreamarrApi = StreamarrHttpClient.create(
        // Re-invoked on every request (see StreamarrHttpClient.create's
        // KDoc), so a base URL saved from the Settings screen takes effect
        // immediately -- no need to rebuild this Retrofit instance.
        baseUrlProvider = { runBlocking { serverConfigStore.baseUrl.first() } },
        clientPlatform = ClientPlatform.AndroidMobile,
        clientVersion = BuildConfig.VERSION_NAME,
        enableHttpLogging = BuildConfig.DEBUG,
    )
}
