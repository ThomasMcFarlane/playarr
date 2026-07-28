package io.playarr.mobile.connected

import io.playarr.shared.data.model.WorkDetail
import java.net.URI
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope

internal data class PlayarrWorkSourceChoice(
    val serverUrl: String,
    val label: String,
    val defaultSource: Boolean,
)

/** Presents joined title sources without exposing their credentials and resolves a chosen detail. */
@Singleton
internal class PlayarrWorkSourceSelector internal constructor(
    private val clientsProvider: suspend () -> List<PlayarrServerClient>,
    private val registry: PlayarrServerSourceRegistry,
) {
    @Inject
    constructor(
        clientProvider: PlayarrServerClientProvider,
        registry: PlayarrServerSourceRegistry,
    ) : this(clientProvider::clients, registry)

    suspend fun choices(workId: String): List<PlayarrWorkSourceChoice> {
        val clients = clientsProvider().also(registry::ensureScope)
        val sources = registry.workSources(workId)
        if (sources.isEmpty()) return emptyList()
        if (sources.size == 1) {
            return listOf(
                PlayarrWorkSourceChoice(
                    serverUrl = sources.single().server.url,
                    label = sources.single().server.url.fallbackServerLabel(),
                    defaultSource = true,
                ),
            )
        }
        return coroutineScope {
            sources.mapIndexed { index, source ->
                async {
                    PlayarrWorkSourceChoice(
                        serverUrl = source.server.url,
                        label = runCatching { source.server.api.getVersion().instanceName }
                            .getOrNull()
                            ?.takeIf(String::isNotBlank)
                            ?: source.server.url.fallbackServerLabel(),
                        defaultSource = index == 0,
                    )
                }
            }.awaitAll().filter { choice -> clients.any { it.url == choice.serverUrl } }
        }
    }

    suspend fun select(workId: String, serverUrl: String): WorkDetail {
        clientsProvider().also(registry::ensureScope)
        val source = registry.workSources(workId).firstOrNull { it.server.url == serverUrl }
            ?: error("That Playarr server is no longer connected.")
        val detail = source.server.api.getWork(source.work.id)
        registry.preferWorkSource(source, detail)
        return detail
    }
}

private fun String.fallbackServerLabel(): String = runCatching {
    URI(this).host?.takeIf(String::isNotBlank)
}.getOrNull() ?: this
