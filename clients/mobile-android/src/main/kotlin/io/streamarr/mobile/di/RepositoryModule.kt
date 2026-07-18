package io.streamarr.mobile.di

import dagger.Binds
import dagger.Module
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import io.streamarr.shared.domain.repository.DefaultVersionRepository
import io.streamarr.shared.domain.repository.VersionRepository
import javax.inject.Singleton

/** Binds core-domain's repository interfaces to their `core-data`-backed default implementations. */
@Module
@InstallIn(SingletonComponent::class)
abstract class RepositoryModule {

    @Binds
    @Singleton
    abstract fun bindVersionRepository(impl: DefaultVersionRepository): VersionRepository
}
