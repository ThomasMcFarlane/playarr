package io.playarr.shared.data.events

import io.playarr.shared.data.remote.PlayarrHttpClient
import kotlinx.serialization.Serializable

/** A typed frame of `GET /api/v1/events` (`docs/architecture/live-events.md`). */
sealed interface LiveEvent {
    /** The cursor this frame advances to (its SSE `id`, else its payload `seq`). */
    val seq: Long

    data class Ready(
        override val seq: Long,
        val retentionMs: Long,
        val heartbeatMs: Long,
        val maxAgeMs: Long,
        val serverTimeMs: Long,
    ) : LiveEvent

    /** One minimal change pointer; never carries an entity body. */
    data class Change(
        override val seq: Long,
        val type: String,
        val entity: String,
        val id: String?,
        val changed: List<String>,
        val at: Long,
    ) : LiveEvent

    /** The resume cursor could not be honoured: refetch everything shown. */
    data class Resync(override val seq: Long, val reason: String?) : LiveEvent
}

@Serializable
private data class ReadyPayload(
    val seq: Long = 0,
    val retentionMs: Long = DEFAULT_RETENTION_MS,
    val heartbeatMs: Long = 15_000,
    val maxAgeMs: Long = 300_000,
    val serverTimeMs: Long = 0,
)

@Serializable
private data class ChangePayload(
    val seq: Long = 0,
    val type: String,
    val entity: String,
    val id: String? = null,
    val changed: List<String> = emptyList(),
    val at: Long = 0,
)

@Serializable
private data class ResyncPayload(val reason: String? = null, val seq: Long = 0)

/** Server retention when the `ready` frame does not say (10 minutes). */
const val DEFAULT_RETENTION_MS: Long = 10 * 60 * 1000L

/** Decodes a frame, or `null` for an unknown event name or malformed payload (forward compatible). */
fun SseFrame.toLiveEvent(): LiveEvent? {
    val json = PlayarrHttpClient.json
    val idSeq = id?.trim()?.toLongOrNull()
    return runCatching {
        when (event) {
            "ready" -> json.decodeFromString<ReadyPayload>(data).let {
                LiveEvent.Ready(idSeq ?: it.seq, it.retentionMs, it.heartbeatMs, it.maxAgeMs, it.serverTimeMs)
            }
            "change" -> json.decodeFromString<ChangePayload>(data).let {
                LiveEvent.Change(idSeq ?: it.seq, it.type, it.entity, it.id, it.changed, it.at)
            }
            "resync" -> json.decodeFromString<ResyncPayload>(data).let {
                LiveEvent.Resync(idSeq ?: it.seq, it.reason)
            }
            else -> null
        }
    }.getOrNull()
}
