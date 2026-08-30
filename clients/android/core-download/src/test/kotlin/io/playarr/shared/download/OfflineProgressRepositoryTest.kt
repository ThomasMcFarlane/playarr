package io.playarr.shared.download

import io.playarr.shared.data.model.WatchProgress
import io.playarr.shared.data.model.WatchState
import io.playarr.shared.data.remote.PlayarrApi
import io.playarr.shared.download.db.PendingProgressDao
import io.playarr.shared.download.db.PendingProgressEntity
import java.io.IOException
import java.lang.reflect.Proxy
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Test

class OfflineProgressRepositoryTest {
    @Test
    fun `pending replay is limited to one bounded batch`() = runBlocking {
        val rows = pendingRows(MAX_PENDING_PROGRESS_REPLAY_BATCH + 10)
        val deleted = mutableListOf<Long>()
        var attempts = 0
        val repository = DefaultOfflineProgressRepository(
            api = playarrApi {
                attempts += 1
                progress(it)
            },
            dao = pendingProgressDao(rows, deleted),
        )

        repository.flushPending()

        assertEquals(MAX_PENDING_PROGRESS_REPLAY_BATCH, attempts)
        assertEquals(rows.take(MAX_PENDING_PROGRESS_REPLAY_BATCH).map(PendingProgressEntity::id), deleted)
    }

    @Test
    fun `pending replay stops after the first failed request`() = runBlocking {
        val rows = pendingRows(10)
        val deleted = mutableListOf<Long>()
        var attempts = 0
        val repository = DefaultOfflineProgressRepository(
            api = playarrApi {
                attempts += 1
                throw IOException("server unavailable")
            },
            dao = pendingProgressDao(rows, deleted),
        )

        repository.flushPending()

        assertEquals(1, attempts)
        assertEquals(emptyList<Long>(), deleted)
    }

    private fun pendingRows(count: Int) = (1..count).map { id ->
        PendingProgressEntity(
            id = id.toLong(),
            mediaFileId = "media-$id",
            positionMs = id * 1_000L,
            durationMs = 60_000L,
            completed = false,
            occurredAtEpochMillis = 1_700_000_000_000L + id,
        )
    }

    private fun pendingProgressDao(
        rows: List<PendingProgressEntity>,
        deleted: MutableList<Long>,
    ) = Proxy.newProxyInstance(
        PendingProgressDao::class.java.classLoader,
        arrayOf(PendingProgressDao::class.java),
    ) { proxy, method, arguments ->
        when (method.name) {
            "getBatch" -> rows.take(arguments.orEmpty().first() as Int)
            "delete" -> Unit.also { deleted += arguments.orEmpty().first() as Long }
            "toString" -> "FakePendingProgressDao"
            "hashCode" -> System.identityHashCode(proxy)
            "equals" -> proxy === arguments?.firstOrNull()
            else -> error("Unexpected DAO call: ${method.name}")
        }
    } as PendingProgressDao

    private fun playarrApi(update: (String) -> WatchProgress) = Proxy.newProxyInstance(
        PlayarrApi::class.java.classLoader,
        arrayOf(PlayarrApi::class.java),
    ) { proxy, method, arguments ->
        when (method.name) {
            "updateWatchProgress" -> update(arguments.orEmpty().first() as String)
            "toString" -> "FakePlayarrApi"
            "hashCode" -> System.identityHashCode(proxy)
            "equals" -> proxy === arguments?.firstOrNull()
            else -> error("Unexpected API call: ${method.name}")
        }
    } as PlayarrApi

    private fun progress(mediaFileId: String) = WatchProgress(
        mediaFileId = mediaFileId,
        workId = "work-$mediaFileId",
        positionMs = 1_000L,
        durationMs = 60_000L,
        state = WatchState.PartWatched,
    )
}
