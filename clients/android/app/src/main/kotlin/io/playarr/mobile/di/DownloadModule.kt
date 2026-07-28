package io.playarr.mobile.di

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
import io.playarr.mobile.download.DefaultPlayarrDownloadServiceStarter
import io.playarr.shared.data.remote.PlayarrServerAccessResolver
import io.playarr.shared.download.DefaultDownloadRepository
import io.playarr.shared.download.DefaultOfflineProgressRepository
import io.playarr.shared.download.DownloadRepository
import io.playarr.shared.download.OfflineProgressRepository
import io.playarr.shared.download.PlayarrDownloadServiceStarter
import io.playarr.shared.download.db.DownloadMetadataDao
import io.playarr.shared.download.db.PendingProgressDao
import io.playarr.shared.download.db.PlayarrDownloadDatabase
import io.playarr.shared.download.db.PLAYARR_DOWNLOAD_MIGRATION_1_2
import io.playarr.shared.download.db.PLAYARR_DOWNLOAD_MIGRATION_2_3
import io.playarr.shared.download.db.PLAYARR_DOWNLOAD_MIGRATION_3_4
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
 * specifically so that [io.playarr.mobile.download.PlayarrDownloadService]
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
    abstract fun bindPlayarrDownloadServiceStarter(impl: DefaultPlayarrDownloadServiceStarter): PlayarrDownloadServiceStarter

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
            val cacheDir = File(context.getExternalFilesDir(null) ?: context.filesDir, "playarr_downloads")
            return SimpleCache(cacheDir, NoOpCacheEvictor(), databaseProvider)
        }

        /**
         * Bearer-token-authenticated `DataSource.Factory` Media3's
         * `DownloadManager` reads download bytes through. Simpler than
         * `PlayarrHttpClient`'s: a download's URI already has the
         * owning server's base URL is resolved into each URI at enqueue time (see
         * `DefaultDownloadRepository.enqueue`). The shared player/download transport resolves the
         * current token by request origin and retries one 401 after rotating that exact server's
         * session; it never forwards a primary token to an unknown absolute media origin.
         */
        @Provides
        @Singleton
        fun provideDownloadDataSourceFactory(
            serverAccessResolver: PlayarrServerAccessResolver,
        ): DataSource.Factory {
            val okHttpClient = OkHttpClient.Builder()
                .addInterceptor { chain ->
                    val requestUrl = chain.request().url
                    val origin = playarrRequestOrigin(requestUrl)
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
                    val origin = playarrRequestOrigin(response.request.url)
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
        fun providePlayarrDownloadDatabase(@ApplicationContext context: Context): PlayarrDownloadDatabase =
            Room.databaseBuilder(context, PlayarrDownloadDatabase::class.java, "playarr_downloads.db")
                .addMigrations(
                    PLAYARR_DOWNLOAD_MIGRATION_1_2,
                    PLAYARR_DOWNLOAD_MIGRATION_2_3,
                    PLAYARR_DOWNLOAD_MIGRATION_3_4,
                )
                .build()

        @Provides
        @Singleton
        fun provideDownloadMetadataDao(database: PlayarrDownloadDatabase): DownloadMetadataDao =
            database.downloadMetadataDao()

        @Provides
        @Singleton
        fun providePendingProgressDao(database: PlayarrDownloadDatabase): PendingProgressDao =
            database.pendingProgressDao()

        private const val DOWNLOAD_MANAGER_MAX_PARALLEL_DOWNLOADS = 3
    }
}

internal fun playarrRequestOrigin(url: HttpUrl): String {
    val host = url.host.let { if (':' in it) "[$it]" else it }
    val defaultPort = url.port == 80 && url.scheme == "http" || url.port == 443 && url.scheme == "https"
    return "${url.scheme}://$host${url.port.takeUnless { defaultPort }?.let { ":$it" }.orEmpty()}"
}
