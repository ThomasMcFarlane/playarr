package io.streamarr.tv.di

import android.os.Build
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import io.streamarr.shared.auth.SessionManager
import io.streamarr.shared.data.config.ServerConfigStore
import io.streamarr.shared.data.model.ClientPlatform
import io.streamarr.shared.data.remote.StreamarrApi
import io.streamarr.shared.data.remote.StreamarrHttpClient
import io.streamarr.tv.BuildConfig
import javax.inject.Singleton
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import io.streamarr.shared.auth.model.ClientPlatform as AuthClientPlatform

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
        clientPlatform = ClientPlatform.AndroidTv,
        clientVersion = BuildConfig.VERSION_NAME,
        // Only invoked by StreamarrHttpClient for the requests
        // submit/approve/reject calls (see `requiresBearerAuth`) -- see
        // mobile-android's NetworkModule for the fuller rationale, which
        // applies identically here.
        accessTokenProvider = {
            runBlocking {
                sessionManager.ensureAccessToken(
                    clientPlatform = AuthClientPlatform.AndroidTv,
                    clientVersion = BuildConfig.VERSION_NAME,
                    deviceName = Build.MODEL ?: "Android TV",
                )
            }
        },
        enableHttpLogging = BuildConfig.DEBUG,
    )
}
