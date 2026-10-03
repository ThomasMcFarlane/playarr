package io.playarr.mobile.di

import android.content.Context
import androidx.media3.datasource.DataSource
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import io.playarr.shared.player.ExoPlayerPlayarrPlayer
import io.playarr.shared.player.PlayarrPlayer
import java.util.concurrent.TimeUnit
import javax.inject.Named
import javax.inject.Singleton
import okhttp3.ConnectionPool
import okhttp3.OkHttpClient
import okhttp3.Protocol

@Module
@InstallIn(SingletonComponent::class)
object PlayerModule {
    @Provides
    @Singleton
    fun providePlayarrPlayer(
        @ApplicationContext context: Context,
        dataSourceFactory: DataSource.Factory,
        @Named(MEDIA_OKHTTP_CLIENT) mediaClient: OkHttpClient,
    ): PlayarrPlayer {
        // Direct play fetches big files over several concurrent range
        // requests. HTTP/1.1 only, so each gets its own TCP flow rather than
        // being multiplexed onto one by HTTP/2; the pool is sized to match.
        // Interceptors and the authenticator are inherited from the media client.
        val parallelClient = mediaClient.newBuilder()
            .protocols(listOf(Protocol.HTTP_1_1))
            .connectionPool(ConnectionPool(PARALLEL_IDLE_CONNECTIONS, PARALLEL_KEEP_ALIVE_MINUTES, TimeUnit.MINUTES))
            .build()
        return ExoPlayerPlayarrPlayer.create(context, dataSourceFactory, parallelClient)
    }

    private const val PARALLEL_IDLE_CONNECTIONS = 8
    private const val PARALLEL_KEEP_ALIVE_MINUTES = 5L
}
