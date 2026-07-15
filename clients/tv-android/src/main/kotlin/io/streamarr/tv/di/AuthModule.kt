package io.streamarr.tv.di

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
import io.streamarr.shared.auth.remote.AuthHttpClient
import io.streamarr.shared.auth.remote.DeviceAuthApi
import io.streamarr.shared.data.config.ServerConfigStore
import io.streamarr.tv.BuildConfig
import javax.inject.Singleton
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking

/** Backs both `core-auth`'s `TokenStore` and `core-data`'s `ServerConfigStore` -- see [provideDeviceAuthApi]'s KDoc. */
private const val CLIENT_PREFS_DATASTORE_FILE_NAME = "streamarr_client_prefs"

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
        enableHttpLogging = BuildConfig.DEBUG,
    )

    // DeviceAuthClient, TokenStore, and ServerConfigStore are
    // @Inject-constructed directly by Hilt from the bindings above -- see
    // mobile-android's AuthModule for the same note.
}
