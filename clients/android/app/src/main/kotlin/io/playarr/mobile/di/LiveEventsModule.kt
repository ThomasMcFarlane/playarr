package io.playarr.mobile.di

import android.content.Context
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import io.playarr.mobile.BuildConfig
import io.playarr.mobile.isTelevision
import io.playarr.shared.auth.SessionRefresher
import io.playarr.shared.auth.TokenStore
import io.playarr.shared.data.config.ServerConfigStore
import io.playarr.shared.data.events.LiveEventsApi
import io.playarr.shared.data.events.LiveEventsConnection
import io.playarr.shared.data.events.LiveEventsManager
import io.playarr.shared.data.events.LiveInvalidationBus
import io.playarr.shared.data.events.asTransport
import io.playarr.shared.data.model.ClientPlatform
import io.playarr.shared.data.remote.PlayarrHttpClient
import javax.inject.Singleton
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking

/** Wires the per-user live event stream (`docs/architecture/live-events.md`). */
@Module
@InstallIn(SingletonComponent::class)
object LiveEventsModule {
    @Provides
    @Singleton
    fun provideLiveEventsApi(
        @ApplicationContext context: Context,
        serverConfigStore: ServerConfigStore,
        tokenStore: TokenStore,
        sessionRefresher: SessionRefresher,
    ): LiveEventsApi = PlayarrHttpClient.createEvents(
        baseUrlProvider = { runBlocking { serverConfigStore.baseUrl.first() } },
        clientPlatform = if (isTelevision(context)) ClientPlatform.AndroidTv else ClientPlatform.AndroidMobile,
        clientVersion = BuildConfig.VERSION_NAME,
        accessTokenProvider = { runBlocking { tokenStore.accessToken.first() } },
        refreshAccessToken = { rejectedToken -> runBlocking { sessionRefresher.refreshAccessToken(rejectedToken) } },
        enableHttpLogging = false,
    )

    @Provides
    @Singleton
    fun provideLiveInvalidationBus(): LiveInvalidationBus = LiveInvalidationBus()

    @Provides
    @Singleton
    fun provideLiveEventsManager(
        @ApplicationContext context: Context,
        api: LiveEventsApi,
        bus: LiveInvalidationBus,
    ): LiveEventsManager = LiveEventsManager(
        scope = CoroutineScope(SupervisorJob() + Dispatchers.Default),
        session = LiveEventsConnection(api.asTransport()),
        bus = bus,
        pollIntervalMs = if (isTelevision(context)) {
            LiveEventsManager.TELEVISION_POLL_MS
        } else {
            LiveEventsManager.FOREGROUND_POLL_MS
        },
    )
}
