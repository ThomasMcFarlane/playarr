package io.streamarr.tv.di

import dagger.Binds
import dagger.Module
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import io.streamarr.shared.domain.repository.DefaultPlaybackRepository
import io.streamarr.shared.domain.repository.DefaultWorkRepository
import io.streamarr.shared.domain.repository.PlaybackRepository
import io.streamarr.shared.domain.repository.WorkRepository
import javax.inject.Singleton

@Module
@InstallIn(SingletonComponent::class)
abstract class RepositoryModule {

    @Binds
    @Singleton
    abstract fun bindWorkRepository(impl: DefaultWorkRepository): WorkRepository

    @Binds
    @Singleton
    abstract fun bindPlaybackRepository(impl: DefaultPlaybackRepository): PlaybackRepository
}
