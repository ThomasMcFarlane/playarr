package io.playarr.mobile.connected

import io.playarr.shared.data.model.Availability
import io.playarr.shared.data.model.CatalogPage
import io.playarr.shared.data.model.DownloadStatus
import io.playarr.shared.data.model.DownloadTicketResponse
import io.playarr.shared.data.model.ExternalProvider
import io.playarr.shared.data.model.ExternalRef
import io.playarr.shared.data.model.MediaChapter
import io.playarr.shared.data.model.PlaybackEventRequest
import io.playarr.shared.data.model.PlaybackInfoResponse
import io.playarr.shared.data.model.PlaybackMode
import io.playarr.shared.data.model.SearchResponse
import io.playarr.shared.data.model.VersionEnvelope
import io.playarr.shared.data.model.Work
import io.playarr.shared.data.model.WorkChildren
import io.playarr.shared.data.model.WorkDetail
import io.playarr.shared.data.model.WorkKind
import io.playarr.shared.data.remote.PlayarrApi
import java.io.IOException
import java.lang.reflect.Proxy
import java.time.Instant
import kotlin.coroutines.Continuation
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.runBlocking
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.Assert.assertEquals
import org.junit.Assert.assertSame
import org.junit.Assert.fail
import org.junit.Test

class JoinedPlayarrApiTest {
    @Test
    fun `browse joins duplicate identities and tolerates an unavailable server`() = runBlocking {
        val first = work("primary-voyage", "Voyage", "329865")
        val duplicate = work("secondary-voyage", "Voyage (2016)", "329865")
        val other = work("secondary-bear", "Zephyr Series", "136315")
        val primary = server("https://primary.example", fakeApi(
            "browseCatalog" to { CatalogPage(listOf(first), 1) },
        ))
        val secondary = server("https://secondary.example", fakeApi(
            "browseCatalog" to { CatalogPage(listOf(duplicate, other), 2) },
        ))
        val unavailable = server("https://offline.example", fakeApi(
            "browseCatalog" to { throw IOException("offline") },
        ))
        val registry = PlayarrServerSourceRegistry()
        val joined = JoinedPlayarrApi(primary.api, { listOf(primary, secondary, unavailable) }, registry)

        val page = joined.browseCatalog(sort = "title")

        assertEquals(listOf("primary-voyage", "secondary-bear"), page.items.map(Work::id))
        assertEquals(3L, page.total)
        assertEquals(
            listOf("primary-voyage", "secondary-voyage"),
            registry.workSources(first.id).map { it.work.id },
        )
    }

    @Test
    fun `search joins items from the current response envelope`() = runBlocking {
        val first = work("primary-voyage", "Voyage", "329865")
        val duplicate = work("secondary-voyage", "Voyage (2016)", "329865")
        val other = work("secondary-moon", "Moon", "17431")
        val primary = server("https://primary.example", fakeApi(
            "searchCatalog" to { SearchResponse(listOf(first)) },
        ))
        val secondary = server("https://secondary.example", fakeApi(
            "searchCatalog" to { SearchResponse(listOf(duplicate, other)) },
        ))
        val joined = JoinedPlayarrApi(
            primary.api,
            { listOf(primary, secondary) },
            PlayarrServerSourceRegistry(),
        )

        val response = joined.searchCatalog("voyage", limit = 2)

        assertEquals(listOf("primary-voyage", "secondary-moon"), response.items.map(Work::id))
    }

    @Test
    fun `unknown secondary work discovers sources and routes media and playback session`() = runBlocking {
        val secondaryWork = work("secondary-work", "Moon", "17431")
        val playbackEvents = mutableListOf<String>()
        val primary = server("https://primary.example", fakeApi(
            "getWork" to { throw IOException("not found") },
            "searchCatalog" to { SearchResponse(emptyList()) },
        ))
        val secondary = server("https://secondary.example", fakeApi(
            "getWork" to { WorkDetail(secondaryWork, WorkChildren.Movie, "secondary-media") },
            "searchCatalog" to { SearchResponse(listOf(secondaryWork)) },
            "getPlaybackInfo" to {
                PlaybackInfoResponse(PlaybackMode.Direct, "/stream", sessionId = "secondary-session")
            },
            "recordPlaybackEvent" to { arguments ->
                playbackEvents += arguments.first() as String
                Unit
            },
        ))
        val registry = PlayarrServerSourceRegistry()
        val joined = JoinedPlayarrApi(primary.api, { listOf(primary, secondary) }, registry)

        val detail = joined.getWork(secondaryWork.id)
        val playback = joined.getPlaybackInfo("secondary-media")
        joined.recordPlaybackEvent(playback.sessionId!!, PlaybackEventRequest.heartbeat(12_000))

        assertEquals("secondary-media", detail.mediaFileId)
        assertSame(secondary, registry.mediaServer("secondary-media"))
        assertEquals(listOf("secondary-session"), playbackEvents)
    }

    @Test
    fun `fanout rethrows cancellation instead of treating it as partial failure`() = runBlocking {
        val first = work("primary", "Voyage", "329865")
        val primary = server("https://primary.example", fakeApi(
            "browseCatalog" to { CatalogPage(listOf(first), 1) },
        ))
        val cancelled = server("https://cancelled.example", fakeApi(
            "browseCatalog" to { throw CancellationException("stale search") },
        ))
        val joined = JoinedPlayarrApi(
            primary.api,
            { listOf(primary, cancelled) },
            PlayarrServerSourceRegistry(),
        )

        try {
            joined.browseCatalog()
            fail("Expected the joined request to preserve coroutine cancellation")
        } catch (expected: CancellationException) {
            assertEquals("stale search", expected.message)
        }
    }

    @Test
    fun `profile or server changes invalidate remembered media ownership`() = runBlocking {
        val secondaryWork = work("secondary-work", "Moon", "17431")
        val primary = server("https://primary.example", fakeApi(
            "getWork" to { throw IOException("not found") },
            "searchCatalog" to { SearchResponse(emptyList()) },
            "getMediaChapters" to { listOf(MediaChapter(0, 0, title = "primary")) },
        ))
        val secondary = server("https://secondary.example", fakeApi(
            "getWork" to { WorkDetail(secondaryWork, WorkChildren.Movie, "shared-media-id") },
            "searchCatalog" to { SearchResponse(listOf(secondaryWork)) },
            "getMediaChapters" to { listOf(MediaChapter(0, 0, title = "secondary")) },
        ))
        var activeClients = listOf(primary, secondary)
        val registry = PlayarrServerSourceRegistry()
        val joined = JoinedPlayarrApi(
            primary.api,
            { activeClients },
            registry,
        )

        joined.getWork(secondaryWork.id)
        assertEquals("secondary", joined.getMediaChapters("shared-media-id").single().title)

        activeClients = listOf(primary.copy(profileUserId = "other-profile"))
        assertEquals("primary", joined.getMediaChapters("shared-media-id").single().title)

        registry.registerDetail(
            secondary,
            WorkDetail(secondaryWork, WorkChildren.Movie, "late-stale-media-id"),
        )
        assertEquals(null, registry.mediaServer("late-stale-media-id"))
    }

    @Test
    fun `unknown persisted download ticket is discovered before secondary cancellation`() = runBlocking {
        val ticket = DownloadTicketResponse(
            id = "secondary-ticket",
            mediaFileId = "secondary-media",
            qualityId = "original",
            status = DownloadStatus.Ready,
            container = "mkv",
            requestedAt = "2026-07-22T00:00:00Z",
        )
        val cancelled = mutableListOf<String>()
        val primary = server("https://primary.example", fakeApi(
            "getDownloadTicket" to { throw IOException("not found") },
        ))
        val secondary = server("https://secondary.example", fakeApi(
            "getDownloadTicket" to { ticket },
            "cancelDownloadTicket" to { arguments ->
                cancelled += arguments.first() as String
                retrofit2.Response.success(ByteArray(0).toResponseBody())
            },
        ))
        val joined = JoinedPlayarrApi(
            primary.api,
            { listOf(primary, secondary) },
            PlayarrServerSourceRegistry(),
        )

        joined.cancelDownloadTicket(ticket.id)

        assertEquals(listOf(ticket.id), cancelled)
    }

    @Test
    fun `source selector exposes safe labels and makes the selected server own its media`() = runBlocking {
        val primaryWork = work("primary-work", "Voyage", "329865")
        val secondaryWork = work("secondary-work", "Voyage", "329865")
        val primary = server("https://primary.example", fakeApi(
            "getVersion" to { VersionEnvelope("Primary Room", "1.0.0", "v1") },
        ))
        val secondary = server("https://secondary.example", fakeApi(
            "getVersion" to { VersionEnvelope("Cinema Room", "1.0.0", "v1") },
            "getWork" to { WorkDetail(secondaryWork, WorkChildren.Movie, "secondary-media") },
        ))
        val registry = PlayarrServerSourceRegistry().also {
            it.ensureScope(listOf(primary, secondary))
            it.registerWorkSources(
                listOf(
                    PlayarrWorkSource(primary, primaryWork),
                    PlayarrWorkSource(secondary, secondaryWork),
                ),
            )
        }
        val selector = PlayarrWorkSourceSelector({ listOf(primary, secondary) }, registry)

        val choices = selector.choices(primaryWork.id)
        val detail = selector.select(primaryWork.id, secondary.url)

        assertEquals(listOf("Primary Room", "Cinema Room"), choices.map { it.label })
        assertEquals(listOf(true, false), choices.map { it.defaultSource })
        assertEquals("secondary-media", detail.mediaFileId)
        assertSame(secondary, registry.mediaServer("secondary-media"))
        assertSame(secondary, registry.preferredWorkSource(primaryWork.id)?.server)
        assertSame(primary, registry.workSources(primaryWork.id).first().server)
    }

    private fun server(url: String, api: PlayarrApi) = PlayarrServerClient(
        profileUserId = "profile",
        url = url,
        username = "viewer",
        api = api,
        accessToken = { "token" },
        refreshAccessToken = { "token" },
        primary = url.contains("primary"),
    )

    private fun work(id: String, title: String, tmdbId: String) = Work(
        id = id,
        kind = WorkKind.Movie,
        externalRefs = listOf(ExternalRef(ExternalProvider.Tmdb, tmdbId)),
        title = title,
        sortTitle = title,
        addedAt = Instant.parse("2026-07-22T00:00:00Z"),
        monitored = true,
        availability = Availability.Available,
    )

    private fun fakeApi(vararg handlers: Pair<String, (List<Any?>) -> Any?>): PlayarrApi {
        val byName = handlers.toMap()
        return Proxy.newProxyInstance(
            PlayarrApi::class.java.classLoader,
            arrayOf(PlayarrApi::class.java),
        ) { proxy, method, rawArguments ->
            when (method.name) {
                "toString" -> "FakePlayarrApi"
                "hashCode" -> System.identityHashCode(proxy)
                "equals" -> proxy === rawArguments?.firstOrNull()
                else -> {
                    val arguments = rawArguments.orEmpty().toList().let { values ->
                        if (values.lastOrNull() is Continuation<*>) values.dropLast(1) else values
                    }
                    byName[method.name]?.invoke(arguments)
                        ?: error("Unexpected PlayarrApi call: ${method.name}")
                }
            }
        } as PlayarrApi
    }
}
