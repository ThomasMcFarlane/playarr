package io.streamarr.mobile.di

import android.content.Context
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import io.streamarr.shared.player.ExoPlayerStreamarrPlayer
import io.streamarr.shared.player.StreamarrPlayer
import javax.inject.Singleton

@Module
@InstallIn(SingletonComponent::class)
object PlayerModule {
    @Provides
    @Singleton
    fun provideStreamarrPlayer(@ApplicationContext context: Context): StreamarrPlayer =
        ExoPlayerStreamarrPlayer.create(context)
}
