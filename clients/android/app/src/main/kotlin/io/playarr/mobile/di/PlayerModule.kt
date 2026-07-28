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
import javax.inject.Singleton

@Module
@InstallIn(SingletonComponent::class)
object PlayerModule {
    @Provides
    @Singleton
    fun providePlayarrPlayer(
        @ApplicationContext context: Context,
        dataSourceFactory: DataSource.Factory,
    ): PlayarrPlayer = ExoPlayerPlayarrPlayer.create(context, dataSourceFactory)
}
