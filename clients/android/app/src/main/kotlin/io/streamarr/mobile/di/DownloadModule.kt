package io.streamarr.mobile.di

import android.content.Context
import androidx.media3.common.util.UnstableApi
import androidx.media3.database.DatabaseProvider
import androidx.media3.database.StandaloneDatabaseProvider
import androidx.media3.datasource.DataSource
import androidx.media3.datasource.cache.Cache
import androidx.media3.datasource.cache.NoOpCacheEvictor
import androidx.media3.datasource.cache.SimpleCache
import androidx.media3.datasource.okhttp.OkHttpDataSource
import androidx.media3.exoplayer.offline.DownloadManager
import androidx.room.Room
import dagger.Binds
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import io.streamarr.mobile.download.DefaultStreamarrDownloadServiceStarter
import io.streamarr.shared.auth.TokenStore
import io.streamarr.shared.download.DefaultDownloadRepository
import io.streamarr.shared.download.DefaultOfflineProgressRepository
import io.streamarr.shared.download.DownloadRepository
import io.streamarr.shared.download.OfflineProgressRepository
import io.streamarr.shared.download.StreamarrDownloadServiceStarter
import io.streamarr.shared.download.db.DownloadMetadataDao
import io.streamarr.shared.download.db.PendingProgressDao
import io.streamarr.shared.download.db.StreamarrDownloadDatabase
import java.io.File
import java.util.concurrent.Executors
import javax.inject.Singleton
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import okhttp3.OkHttpClient

/**
 * Wires Media3's real offline-download stack (`SimpleCache`/
 * `StandaloneDatabaseProvider`/an authenticated `OkHttpDataSource`/
 * `DownloadManager`) plus `core-download`'s Room database into Hilt, and
 * binds `core-download`'s repository interfaces to their default
 * implementations -- following `RepositoryModule.kt`'s exact `@Binds`
 * pattern for the bindings, and `NetworkModule.kt`'s pattern for building
 * an authenticated OkHttp client.
 *
 * `DownloadManager`/`Cache` are provided here (not in `core-download`)
 * specifically so that [io.streamarr.mobile.download.StreamarrDownloadService]
 * (also in this module, for the same reason -- see its KDoc) can host the
 * exact same singleton instances Media3 requires the service and any direct
 * `DownloadManager` reads elsewhere in the app to share.
 */
@Module
@InstallIn(SingletonComponent::class)
@UnstableApi
abstract class DownloadModule {

    @Binds
    @Singleton
    abstract fun bindDownloadRepository(impl: DefaultDownloadRepository): DownloadRepository

    @Binds
    @Singleton
    abstract fun bindOfflineProgressRepository(impl: DefaultOfflineProgressRepository): OfflineProgressRepository

    @Binds
    @Singleton
    abstract fun bindStreamarrDownloadServiceStarter(impl: DefaultStreamarrDownloadServiceStarter): StreamarrDownloadServiceStarter

    companion object {

        @Provides
        @Singleton
        fun provideDownloadDatabaseProvider(@ApplicationContext context: Context): DatabaseProvider =
            StandaloneDatabaseProvider(context)

        /**
         * `NoOpCacheEvictor`: downloads are user-controlled (explicit
         * enqueue/cancel + the Keep-until sweep), not an LRU cache the
         * system is free to silently evict content from -- a user who
         * chose "Forever" must not lose bytes to space pressure without
         * being told.
         */
        @Provides
        @Singleton
        fun provideDownloadCache(@ApplicationContext context: Context, databaseProvider: DatabaseProvider): Cache {
            val cacheDir = File(context.getExternalFilesDir(null) ?: context.filesDir, "streamarr_downloads")
            return SimpleCache(cacheDir, NoOpCacheEvictor(), databaseProvider)
        }

        /**
         * Bearer-token-authenticated `DataSource.Factory` Media3's
         * `DownloadManager` reads download bytes through. Simpler than
         * `StreamarrHttpClient`'s: a download's URI already has the
         * operator's base URL resolved into it at enqueue time (see
         * `DefaultDownloadRepository.enqueue`), so this only needs to
         * attach the current access token per request, not rewrite the
         * host -- and it doesn't need the 401-retry `Authenticator` either,
         * since a rejected download simply surfaces as a Media3
         * `STATE_FAILED` the user can retry from the Downloads screen
         * (whereas a live network request has a human waiting on it right
         * now, worth transparently retrying once).
         */
        @Provides
        @Singleton
        fun provideDownloadDataSourceFactory(tokenStore: TokenStore): DataSource.Factory {
            val okHttpClient = OkHttpClient.Builder()
                .addInterceptor { chain ->
                    val token = runBlocking { tokenStore.accessToken.first() }
                    val request = if (token.isNullOrBlank()) {
                        chain.request()
                    } else {
                        chain.request().newBuilder().header("Authorization", "Bearer $token").build()
                    }
                    chain.proceed(request)
                }
                .build()
            return OkHttpDataSource.Factory(okHttpClient)
        }

        @Provides
        @Singleton
        fun provideDownloadManager(
            @ApplicationContext context: Context,
            databaseProvider: DatabaseProvider,
            cache: Cache,
            dataSourceFactory: DataSource.Factory,
        ): DownloadManager = DownloadManager(
            context,
            databaseProvider,
            cache,
            dataSourceFactory,
            Executors.newFixedThreadPool(DOWNLOAD_MANAGER_MAX_PARALLEL_DOWNLOADS),
        )

        @Provides
        @Singleton
        fun provideStreamarrDownloadDatabase(@ApplicationContext context: Context): StreamarrDownloadDatabase =
            Room.databaseBuilder(context, StreamarrDownloadDatabase::class.java, "streamarr_downloads.db").build()

        @Provides
        @Singleton
        fun provideDownloadMetadataDao(database: StreamarrDownloadDatabase): DownloadMetadataDao =
            database.downloadMetadataDao()

        @Provides
        @Singleton
        fun providePendingProgressDao(database: StreamarrDownloadDatabase): PendingProgressDao =
            database.pendingProgressDao()

        private const val DOWNLOAD_MANAGER_MAX_PARALLEL_DOWNLOADS = 3
    }
}
