package io.playarr.mobile.di

import android.content.Context
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import io.playarr.mobile.BuildConfig
import io.playarr.mobile.connected.AndroidPlayarrServerAccessResolver
import io.playarr.mobile.connected.ConnectedServerApiFactory
import io.playarr.mobile.connected.JoinedPlayarrApi
import io.playarr.mobile.connected.PlayarrServerClientProvider
import io.playarr.mobile.connected.PlayarrServerSourceRegistry
import io.playarr.mobile.isTelevision
import io.playarr.shared.auth.ConnectedServerSessionManager
import io.playarr.shared.auth.ConnectedServerSessionStore
import io.playarr.shared.auth.SessionRefresher
import io.playarr.shared.auth.TokenStore
import io.playarr.shared.data.config.ServerConfigStore
import io.playarr.shared.data.model.ClientPlatform
import io.playarr.shared.data.remote.PlayarrApi
import io.playarr.shared.data.remote.PlayarrHttpClient
import io.playarr.shared.data.remote.PlayarrRemoteApi
import io.playarr.shared.data.remote.PlayarrServerAccessResolver
import javax.inject.Qualifier
import javax.inject.Singleton
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking

/**
 * Wires `core-data`'s framework-agnostic [PlayarrHttpClient] factory
 * into Hilt. Kept as a plain `@Provides` function (not `@Binds`) because
 * [PlayarrApi] is built by a factory, not directly `@Inject`-constructed.
 */
@Module
@InstallIn(SingletonComponent::class)
object NetworkModule {

    @Provides
    @Singleton
    @PrimaryPlayarrApi
    fun providePrimaryPlayarrApi(
        @ApplicationContext context: Context,
        serverConfigStore: ServerConfigStore,
        tokenStore: TokenStore,
        sessionRefresher: SessionRefresher,
    ): PlayarrApi = PlayarrHttpClient.create(
        // Re-invoked on every request (see PlayarrHttpClient.create's
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

    /** Phone remote and handoff endpoints; always the signed-in primary server. */
    @Provides
    @Singleton
    fun providePlayarrRemoteApi(
        @ApplicationContext context: Context,
        serverConfigStore: ServerConfigStore,
        tokenStore: TokenStore,
        sessionRefresher: SessionRefresher,
    ): PlayarrRemoteApi = PlayarrHttpClient.createRemote(
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
        enableHttpLogging = false,
    )

    @Provides
    @Singleton
    internal fun provideConnectedServerApiFactory(
        @ApplicationContext context: Context,
        store: ConnectedServerSessionStore,
        sessionManager: ConnectedServerSessionManager,
    ): ConnectedServerApiFactory = ConnectedServerApiFactory(
        store = store,
        sessionManager = sessionManager,
        clientPlatform = if (isTelevision(context)) ClientPlatform.AndroidTv else ClientPlatform.AndroidMobile,
        clientVersion = BuildConfig.VERSION_NAME,
    )

    @Provides
    @Singleton
    internal fun providePlayarrServerSourceRegistry(): PlayarrServerSourceRegistry = PlayarrServerSourceRegistry()

    @Provides
    @Singleton
    internal fun providePlayarrServerClientProvider(
        @PrimaryPlayarrApi primary: PlayarrApi,
        connectedServerApiFactory: ConnectedServerApiFactory,
        serverConfigStore: ServerConfigStore,
        tokenStore: TokenStore,
        sessionRefresher: SessionRefresher,
    ): PlayarrServerClientProvider = PlayarrServerClientProvider(
        primary,
        connectedServerApiFactory,
        serverConfigStore,
        tokenStore,
        sessionRefresher,
    )

    @Provides
    @Singleton
    internal fun providePlayarrServerAccessResolver(
        resolver: AndroidPlayarrServerAccessResolver,
    ): PlayarrServerAccessResolver = resolver

    @Provides
    @Singleton
    internal fun providePlayarrApi(
        @PrimaryPlayarrApi primary: PlayarrApi,
        clientProvider: PlayarrServerClientProvider,
        sourceRegistry: PlayarrServerSourceRegistry,
    ): PlayarrApi = JoinedPlayarrApi(
        primary = primary,
        clientsProvider = clientProvider::clients,
        registry = sourceRegistry,
    )
}

@Qualifier
@Retention(AnnotationRetention.BINARY)
internal annotation class PrimaryPlayarrApi
