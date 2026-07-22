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
import io.streamarr.shared.data.remote.StreamarrServerAccessResolver
import io.streamarr.shared.download.DefaultDownloadRepository
import io.streamarr.shared.download.DefaultOfflineProgressRepository
import io.streamarr.shared.download.DownloadRepository
import io.streamarr.shared.download.OfflineProgressRepository
import io.streamarr.shared.download.StreamarrDownloadServiceStarter
import io.streamarr.shared.download.db.DownloadMetadataDao
import io.streamarr.shared.download.db.PendingProgressDao
import io.streamarr.shared.download.db.StreamarrDownloadDatabase
import io.streamarr.shared.download.db.STREAMARR_DOWNLOAD_MIGRATION_1_2
import io.streamarr.shared.download.db.STREAMARR_DOWNLOAD_MIGRATION_2_3
import java.io.File
import java.util.concurrent.Executors
import javax.inject.Singleton
import kotlinx.coroutines.runBlocking
import okhttp3.HttpUrl
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
         * owning server's base URL is resolved into each URI at enqueue time (see
         * `DefaultDownloadRepository.enqueue`). The shared player/download transport resolves the
         * current token by request origin and retries one 401 after rotating that exact server's
         * session; it never forwards a primary token to an unknown absolute media origin.
         */
        @Provides
        @Singleton
        fun provideDownloadDataSourceFactory(
            serverAccessResolver: StreamarrServerAccessResolver,
        ): DataSource.Factory {
            val okHttpClient = OkHttpClient.Builder()
                .addInterceptor { chain ->
                    val requestUrl = chain.request().url
                    val origin = streamarrRequestOrigin(requestUrl)
                    val token = runBlocking { serverAccessResolver.forServerUrl(origin).accessToken }
                    val request = if (token.isNullOrBlank()) {
                        chain.request()
                    } else {
                        chain.request().newBuilder().header("Authorization", "Bearer $token").build()
                    }
                    chain.proceed(request)
                }
                .authenticator { _, response ->
                    if (response.priorResponse?.code == 401) return@authenticator null
                    val rejectedToken = response.request.header("Authorization")
                        ?.removePrefix("Bearer ")
                        ?.takeIf(String::isNotBlank)
                    val origin = streamarrRequestOrigin(response.request.url)
                    val refreshed = runBlocking {
                        serverAccessResolver.refreshForServerUrl(origin, rejectedToken)
                    }
                    if (refreshed.isNullOrBlank() || refreshed == rejectedToken) {
                        null
                    } else {
                        response.request.newBuilder().header("Authorization", "Bearer $refreshed").build()
                    }
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
            Room.databaseBuilder(context, StreamarrDownloadDatabase::class.java, "streamarr_downloads.db")
                .addMigrations(STREAMARR_DOWNLOAD_MIGRATION_1_2, STREAMARR_DOWNLOAD_MIGRATION_2_3)
                .build()

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

internal fun streamarrRequestOrigin(url: HttpUrl): String {
    val host = url.host.let { if (':' in it) "[$it]" else it }
    val defaultPort = url.port == 80 && url.scheme == "http" || url.port == 443 && url.scheme == "https"
    return "${url.scheme}://$host${url.port.takeUnless { defaultPort }?.let { ":$it" }.orEmpty()}"
}
