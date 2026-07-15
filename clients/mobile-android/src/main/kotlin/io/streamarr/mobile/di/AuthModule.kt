package io.streamarr.mobile.di

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
import io.streamarr.mobile.BuildConfig
import io.streamarr.shared.auth.remote.AuthHttpClient
import io.streamarr.shared.auth.remote.DeviceAuthApi
import javax.inject.Singleton

private const val TOKEN_DATASTORE_FILE_NAME = "streamarr_auth_tokens"

@Module
@InstallIn(SingletonComponent::class)
object AuthModule {

    @Provides
    @Singleton
    fun provideTokenDataStore(@ApplicationContext context: Context): DataStore<Preferences> =
        PreferenceDataStoreFactory.create(
            produceFile = { context.preferencesDataStoreFile(TOKEN_DATASTORE_FILE_NAME) },
        )

    @Provides
    @Singleton
    fun provideDeviceAuthApi(): DeviceAuthApi =
        AuthHttpClient.create(baseUrl = BuildConfig.STREAMARR_BASE_URL, enableHttpLogging = BuildConfig.DEBUG)

    // DeviceAuthClient and TokenStore are not provided here: both carry
    // `@Inject constructor(...)` over dependencies already bound above
    // (DeviceAuthApi, DataStore<Preferences>), so Hilt constructs them
    // directly without an explicit @Provides.
}
