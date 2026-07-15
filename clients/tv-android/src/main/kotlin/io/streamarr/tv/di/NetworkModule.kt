package io.streamarr.tv.di

import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import io.streamarr.shared.data.config.ServerConfigStore
import io.streamarr.shared.data.model.ClientPlatform
import io.streamarr.shared.data.remote.StreamarrApi
import io.streamarr.shared.data.remote.StreamarrHttpClient
import io.streamarr.tv.BuildConfig
import javax.inject.Singleton
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking

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
        clientPlatform = ClientPlatform.AndroidTv,
        clientVersion = BuildConfig.VERSION_NAME,
        enableHttpLogging = BuildConfig.DEBUG,
    )
}
