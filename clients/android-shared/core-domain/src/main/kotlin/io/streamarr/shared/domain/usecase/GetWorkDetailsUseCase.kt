package io.streamarr.shared.domain.usecase

import io.streamarr.shared.data.model.WorkKind
import io.streamarr.shared.domain.model.StreamarrResult
import io.streamarr.shared.domain.model.WorkDetails
import io.streamarr.shared.domain.model.runCatchingStreamarr
import io.streamarr.shared.domain.repository.WorkRepository
import javax.inject.Inject
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope

/**
 * Loads a [WorkDetails]: the [io.streamarr.shared.data.model.Work] itself,
 * its seasons (fetched in parallel, only for [WorkKind.Series]), and its
 * media files -- everything a work-detail screen needs in one call.
 */
class GetWorkDetailsUseCase @Inject constructor(
    private val workRepository: WorkRepository,
) {
    suspend operator fun invoke(workId: String): StreamarrResult<WorkDetails> = runCatchingStreamarr {
        coroutineScope {
            val workDeferred = async { workRepository.getWork(workId) }
            val mediaFilesDeferred = async { workRepository.listMediaFiles(workId) }

            val work = workDeferred.await()
            val seasons = if (work.kind == WorkKind.Series) {
                workRepository.listSeasons(workId)
            } else {
                emptyList()
            }

            WorkDetails(work = work, seasons = seasons, mediaFiles = mediaFilesDeferred.await())
        }
    }
}
