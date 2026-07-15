package io.streamarr.shared.domain.model

import io.streamarr.shared.data.model.MediaFile
import io.streamarr.shared.data.model.Season
import io.streamarr.shared.data.model.Work

/**
 * A [Work] plus the children a detail screen needs to render, assembled
 * from several `StreamarrApi` calls by [io.streamarr.shared.domain.usecase.GetWorkDetailsUseCase].
 * `seasons` is empty for non-series works.
 */
data class WorkDetails(
    val work: Work,
    val seasons: List<Season>,
    val mediaFiles: List<MediaFile>,
)
