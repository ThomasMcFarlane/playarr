package io.playarr.mobile.connected

import io.playarr.shared.download.db.DownloadMetadataDao
import io.playarr.shared.download.db.DownloadMetadataEntity
import java.lang.reflect.Proxy
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class AndroidPlayarrServerAccessResolverTest {
    @Test
    fun `media owner uses the latest rotating secondary token`() = runBlocking {
        var token = "first-token"
        val primary = server("profile", "https://primary.example", "primary-token", primary = true)
        val secondary = server("profile", "https://secondary.example", token)
        val registry = PlayarrServerSourceRegistry().also {
            it.ensureScope(listOf(primary, secondary))
            it.registerMediaServer("secondary-media", secondary.copy(accessToken = { token }))
        }
        val resolver = AndroidPlayarrServerAccessResolver(
            clientsProvider = { listOf(primary, secondary.copy(accessToken = { token })) },
            registry = registry,
            downloadMetadataDao = FakeDownloadMetadataDao(),
        )

        assertEquals("first-token", resolver.forMedia("secondary-media").accessToken)
        token = "rotated-token"
        assertEquals("rotated-token", resolver.forMedia("secondary-media").accessToken)
    }

    @Test
    fun `persisted download origin restores media ownership after process registry loss`() = runBlocking {
        val primary = server("profile", "https://primary.example", "primary-token", primary = true)
        val secondary = server("profile", "https://secondary.example", "secondary-token")
        val registry = PlayarrServerSourceRegistry()
        val resolver = AndroidPlayarrServerAccessResolver(
            clientsProvider = { listOf(primary, secondary) },
            registry = registry,
            downloadMetadataDao = FakeDownloadMetadataDao(
                metadata("secondary-media", "https://secondary.example"),
            ),
        )

        val access = resolver.forMedia("secondary-media")

        assertEquals("https://secondary.example", access.serverUrl)
        assertEquals("secondary-token", access.accessToken)
        assertEquals(secondary.url, registry.mediaServer("secondary-media")?.url)
    }

    @Test
    fun `unknown request origin never receives the primary bearer token`() = runBlocking {
        val primary = server("profile", "https://primary.example", "primary-token", primary = true)
        val resolver = AndroidPlayarrServerAccessResolver(
            clientsProvider = { listOf(primary) },
            registry = PlayarrServerSourceRegistry(),
            downloadMetadataDao = FakeDownloadMetadataDao(),
        )

        val access = resolver.forServerUrl("https://disconnected.example")

        assertEquals("https://disconnected.example", access.serverUrl)
        assertNull(access.accessToken)
    }

    @Test
    fun `media transport refresh is scoped to the rejected request origin`() = runBlocking {
        var rejected: String? = null
        val primary = server("profile", "https://primary.example", "primary-token", primary = true)
        val secondary = server("profile", "https://secondary.example", "expired-token").copy(
            refreshAccessToken = { value ->
                rejected = value
                "rotated-secondary-token"
            },
        )
        val resolver = AndroidPlayarrServerAccessResolver(
            clientsProvider = { listOf(primary, secondary) },
            registry = PlayarrServerSourceRegistry(),
            downloadMetadataDao = FakeDownloadMetadataDao(),
        )

        val refreshed = resolver.refreshForServerUrl("https://secondary.example/path", "expired-token")

        assertEquals("expired-token", rejected)
        assertEquals("rotated-secondary-token", refreshed)
        assertNull(resolver.refreshForServerUrl("https://unknown.example", "primary-token"))
    }

    private fun server(profile: String, url: String, token: String, primary: Boolean = false) =
        PlayarrServerClient(
            profileUserId = profile,
            url = url,
            username = "viewer",
            api = Proxy.newProxyInstance(
                io.playarr.shared.data.remote.PlayarrApi::class.java.classLoader,
                arrayOf(io.playarr.shared.data.remote.PlayarrApi::class.java),
            ) { _, method, _ -> error("Unexpected API call: ${method.name}") } as io.playarr.shared.data.remote.PlayarrApi,
            accessToken = { token },
            refreshAccessToken = { token },
            primary = primary,
        )

    private fun metadata(mediaFileId: String, serverUrl: String) = DownloadMetadataEntity(
        mediaFileId = mediaFileId,
        workId = "work",
        title = "Title",
        workTitle = "Work",
        posterUrl = null,
        kind = "movie",
        qualityId = "original",
        ticketId = "ticket",
        serverUrl = serverUrl,
        keepUntilEpochMillis = null,
        addedAtEpochMillis = 0,
    )

    private class FakeDownloadMetadataDao(
        private vararg val rows: DownloadMetadataEntity,
    ) : DownloadMetadataDao {
        override fun observeAll(): Flow<List<DownloadMetadataEntity>> = flowOf(rows.toList())
        override suspend fun get(mediaFileId: String): DownloadMetadataEntity? = rows.firstOrNull {
            it.mediaFileId == mediaFileId
        }
        override suspend fun getAllOnce(): List<DownloadMetadataEntity> = rows.toList()
        override suspend fun upsert(entity: DownloadMetadataEntity) = Unit
        override suspend fun delete(mediaFileId: String) = Unit
        override suspend fun updateKeepUntil(
            mediaFileId: String,
            keepUntilEpochMillis: Long?,
            keepUntilAmount: Int?,
            keepUntilUnit: String?,
            watchedAtEpochMillis: Long?,
        ) = Unit
        override suspend fun updateWatchedAt(mediaFileId: String, watchedAtEpochMillis: Long) = Unit
    }
}
