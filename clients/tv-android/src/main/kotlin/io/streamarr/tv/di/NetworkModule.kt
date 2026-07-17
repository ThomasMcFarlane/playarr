package io.streamarr.tv.di

import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import io.streamarr.shared.data.model.ClientPlatform
import io.streamarr.shared.auth.TokenStore
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
    fun provideStreamarrApi(tokenStore: TokenStore): StreamarrApi = StreamarrHttpClient.create(
        baseUrlProvider = { BuildConfig.PLAYARR_BASE_URL },
        clientPlatform = ClientPlatform.AndroidTv,
        clientVersion = BuildConfig.VERSION_NAME,
        accessTokenProvider = { runBlocking { tokenStore.accessToken.first() } },
        enableHttpLogging = BuildConfig.DEBUG,
    )
}
