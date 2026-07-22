package io.streamarr.mobile.di

import android.content.Context
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import io.streamarr.mobile.BuildConfig
import io.streamarr.mobile.connected.ConnectedServerApiFactory
import io.streamarr.mobile.connected.JoinedStreamarrApi
import io.streamarr.mobile.connected.PlayarrServerClient
import io.streamarr.mobile.connected.PlayarrServerSourceRegistry
import io.streamarr.mobile.isTelevision
import io.streamarr.shared.auth.ConnectedServerSessionManager
import io.streamarr.shared.auth.ConnectedServerSessionStore
import io.streamarr.shared.auth.SessionRefresher
import io.streamarr.shared.auth.TokenStore
import io.streamarr.shared.data.config.ServerConfigStore
import io.streamarr.shared.data.model.ClientPlatform
import io.streamarr.shared.data.remote.StreamarrApi
import io.streamarr.shared.data.remote.StreamarrHttpClient
import javax.inject.Singleton
import javax.inject.Qualifier
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
    @PrimaryStreamarrApi
    fun providePrimaryStreamarrApi(
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
    internal fun provideStreamarrApi(
        @PrimaryStreamarrApi primary: StreamarrApi,
        connectedServerApiFactory: ConnectedServerApiFactory,
        sourceRegistry: PlayarrServerSourceRegistry,
        serverConfigStore: ServerConfigStore,
        tokenStore: TokenStore,
    ): StreamarrApi = JoinedStreamarrApi(
        primary = primary,
        clientsProvider = {
            val profileUserId = tokenStore.currentUserId.first()
            val primaryClient = PlayarrServerClient(
                profileUserId = profileUserId.orEmpty(),
                url = serverConfigStore.baseUrl.first(),
                username = tokenStore.currentUserName.first() ?: "Viewer",
                api = primary,
                accessToken = { tokenStore.accessToken.first() },
                primary = true,
            )
            listOf(primaryClient) + if (profileUserId == null) {
                emptyList()
            } else {
                connectedServerApiFactory.clientsForProfile(profileUserId)
            }
        },
        registry = sourceRegistry,
    )
}

@Qualifier
@Retention(AnnotationRetention.BINARY)
internal annotation class PrimaryStreamarrApi
