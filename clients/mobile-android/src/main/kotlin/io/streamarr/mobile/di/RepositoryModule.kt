package io.streamarr.mobile.di

import dagger.Binds
import dagger.Module
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import io.streamarr.shared.domain.repository.DefaultPlaybackRepository
import io.streamarr.shared.domain.repository.DefaultVersionRepository
import io.streamarr.shared.domain.repository.DefaultWorkRepository
import io.streamarr.shared.domain.repository.PlaybackRepository
import io.streamarr.shared.domain.repository.VersionRepository
import io.streamarr.shared.domain.repository.WorkRepository
import javax.inject.Singleton

/** Binds core-domain's repository interfaces to their `core-data`-backed default implementations. */
@Module
@InstallIn(SingletonComponent::class)
abstract class RepositoryModule {

    @Binds
    @Singleton
    abstract fun bindWorkRepository(impl: DefaultWorkRepository): WorkRepository

    @Binds
    @Singleton
    abstract fun bindPlaybackRepository(impl: DefaultPlaybackRepository): PlaybackRepository

    @Binds
    @Singleton
    abstract fun bindVersionRepository(impl: DefaultVersionRepository): VersionRepository
}
