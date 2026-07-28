package io.playarr.mobile.di

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.PreferenceDataStoreFactory
import androidx.datastore.preferences.preferencesDataStoreFile
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import io.playarr.shared.auth.remote.AuthHttpClient
import io.playarr.shared.auth.remote.DeviceAuthApi
import io.playarr.shared.auth.remote.LoginApi
import io.playarr.shared.auth.remote.LoginApiForUrl
import io.playarr.shared.auth.remote.HostedDeviceLinkApi
import io.playarr.shared.auth.remote.RefreshApi
import io.playarr.shared.auth.remote.RefreshApiForUrl
import io.playarr.shared.data.config.ServerConfigStore
import javax.inject.Singleton
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking

/** Backs both `core-auth`'s `TokenStore` and `core-data`'s `ServerConfigStore` -- see [provideDeviceAuthApi]'s KDoc. */
private const val CLIENT_PREFS_DATASTORE_FILE_NAME = "playarr_client_prefs"

@Module
@InstallIn(SingletonComponent::class)
object AuthModule {

    @Provides
    @Singleton
    fun provideClientPrefsDataStore(@ApplicationContext context: Context): DataStore<Preferences> =
        PreferenceDataStoreFactory.create(
            produceFile = { context.preferencesDataStoreFile(CLIENT_PREFS_DATASTORE_FILE_NAME) },
        )

    /**
     * [baseUrlProvider] reads [ServerConfigStore] (itself backed by the
     * same `DataStore<Preferences>` singleton as `TokenStore`) rather than
     * a fixed `BuildConfig` value, so a base URL saved from the Settings
     * screen takes effect on the very next pairing request.
     */
    @Provides
    @Singleton
    fun provideDeviceAuthApi(serverConfigStore: ServerConfigStore): DeviceAuthApi = AuthHttpClient.create(
        baseUrlProvider = { runBlocking { serverConfigStore.baseUrl.first() } },
        // Account credentials must never be written to logcat, including in
        // locally distributed debug-signed APKs.
        enableHttpLogging = false,
    )

    @Provides
    @Singleton
    fun provideHostedDeviceLinkApi(): HostedDeviceLinkApi =
        AuthHttpClient.createHostedDeviceLinkApi(enableHttpLogging = false)

    /** Backs [io.playarr.shared.auth.SessionManager]'s transparent `POST /api/v1/auth/login` call. */
    @Provides
    @Singleton
    fun provideLoginApi(serverConfigStore: ServerConfigStore): LoginApi = AuthHttpClient.createLoginApi(
        baseUrlProvider = { runBlocking { serverConfigStore.baseUrl.first() } },
        enableHttpLogging = false,
    )

    /**
     * Builds an unauthenticated [LoginApi] pointed at an arbitrary
     * address rather than whatever [ServerConfigStore] currently holds --
     * what `SessionManager` retries a fresh login attempt against every
     * other remembered group address with, once the default
     * [provideLoginApi] instance fails (`docs/architecture/
     * peer-groups.md` §6.4/§7.2/§3.7).
     */
    @Provides
    @Singleton
    fun provideLoginApiForUrl(): LoginApiForUrl = LoginApiForUrl { url ->
        AuthHttpClient.createLoginApi(baseUrlProvider = { url }, enableHttpLogging = false)
    }

    @Provides
    @Singleton
    fun provideRefreshApi(serverConfigStore: ServerConfigStore): RefreshApi = AuthHttpClient.createRefreshApi(
        baseUrlProvider = { runBlocking { serverConfigStore.baseUrl.first() } },
        enableHttpLogging = false,
    )

    /**
     * Builds an unauthenticated [RefreshApi] pointed at an arbitrary
     * address rather than whatever [ServerConfigStore] currently holds --
     * what `SessionRefresher` retries a still-unredeemed refresh token
     * against every other remembered address with, once the default
     * [provideRefreshApi] instance fails (`docs/architecture/
     * peer-groups.md` §6.4/§7.2/§3.7).
     */
    @Provides
    @Singleton
    fun provideRefreshApiForUrl(): RefreshApiForUrl = RefreshApiForUrl { url ->
        AuthHttpClient.createRefreshApi(baseUrlProvider = { url }, enableHttpLogging = false)
    }

    // DeviceAuthClient, TokenStore, SessionManager, SessionRefresher,
    // ServerConfigStore, and KnownServerGroupStore are not provided here:
    // all carry `@Inject constructor(...)` over dependencies already bound
    // above (DeviceAuthApi, LoginApi, RefreshApi, DataStore<Preferences>),
    // so Hilt constructs them directly without an explicit @Provides.
}
