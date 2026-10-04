package io.playarr.shared.data.events

import java.util.concurrent.ConcurrentHashMap
import kotlinx.coroutines.channels.BufferOverflow
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.filter

/** Which family of on-screen data a [LiveTarget] names. */
enum class LiveArea {
    /** One work: detail, seasons and episodes, progress badges. [LiveTarget.id] is the work id. */
    Work,

    /** The account's watch progress: watched badges, Continue Watching, Up Next. */
    Progress,
    Home,
    Library,
    Search,
    Calendar,

    /** The playlist list, or one playlist's detail when [LiveTarget.id] is set. */
    Playlist,
    Watchlist,
    Downloads,
    Household,
    Account,
    Admin,
}

/**
 * A unit of refetchable state. A `null` [id] on an event's target means
 * "every id of this area" (a bulk change); a `null` [id] on a consumer's
 * interest means it does not care which id.
 */
data class LiveTarget(val area: LiveArea, val id: String? = null) {
    fun overlaps(other: LiveTarget): Boolean =
        area == other.area && (id == null || other.id == null || id == other.id)
}

/**
 * What to refetch. [everything] (resync, long background gap) and [poll]
 * (fallback tick) match every consumer. [atLocalMs] is the change time on the
 * device's wall clock (server `at` minus the clock offset learned from `ready`),
 * or `null` when unknown, in which case it is never dropped as old.
 */
data class Invalidation(
    val targets: Set<LiveTarget> = emptySet(),
    val everything: Boolean = false,
    val poll: Boolean = false,
    val atLocalMs: Long? = null,
) {
    fun affects(interest: Set<LiveTarget>): Boolean =
        everything || poll || targets.any { t -> interest.any(t::overlaps) }

    /** Whether data fetched starting at [fetchStartedMs] (device wall clock) may predate this change. */
    fun newerThan(fetchStartedMs: Long): Boolean = atLocalMs == null || atLocalMs > fetchStartedMs

    /** [affects] and not already covered by a fetch that began at or after the change. */
    fun requiresRefetch(interest: Set<LiveTarget>, fetchStartedMs: Long): Boolean =
        affects(interest) && newerThan(fetchStartedMs)

    fun merge(other: Invalidation): Invalidation = Invalidation(
        targets = targets + other.targets,
        everything = everything || other.everything,
        poll = poll || other.poll,
        atLocalMs = when {
            isEmpty() -> other.atLocalMs
            other.isEmpty() -> atLocalMs
            atLocalMs == null || other.atLocalMs == null -> null
            else -> maxOf(atLocalMs, other.atLocalMs)
        },
    )

    private fun isEmpty() = targets.isEmpty() && !everything && !poll
}

/** The design doc's event -> refetch table (`docs/architecture/live-events.md`). */
object LiveEventMapper {
    /** Targets for [event], or `null` when the event type is unknown (ignored, forward compatible). */
    fun targetsFor(event: LiveEvent.Change): Set<LiveTarget>? {
        val id = event.id?.takeIf { event.entity != "*" }
        val bulk = event.entity == "*" || "bulk" in event.changed
        return when (event.type) {
            "watch" -> setOf(
                LiveTarget(LiveArea.Work, id),
                LiveTarget(LiveArea.Progress),
                LiveTarget(LiveArea.Home),
            )
            "library" -> if (bulk) {
                setOf(
                    LiveTarget(LiveArea.Work),
                    LiveTarget(LiveArea.Library),
                    LiveTarget(LiveArea.Home),
                    LiveTarget(LiveArea.Search),
                    LiveTarget(LiveArea.Calendar),
                    LiveTarget(LiveArea.Playlist),
                )
            } else {
                setOf(
                    LiveTarget(LiveArea.Work, id),
                    LiveTarget(LiveArea.Library),
                    LiveTarget(LiveArea.Home),
                    LiveTarget(LiveArea.Search),
                )
            }
            "calendar" -> setOf(LiveTarget(LiveArea.Calendar))
            "playlist" -> setOf(LiveTarget(LiveArea.Playlist, id))
            "watchlist" -> setOf(LiveTarget(LiveArea.Watchlist))
            "download" -> setOf(LiveTarget(LiveArea.Downloads))
            "household" -> setOf(LiveTarget(LiveArea.Household))
            "account" -> setOf(
                LiveTarget(LiveArea.Account),
                LiveTarget(LiveArea.Household),
                LiveTarget(LiveArea.Library),
                LiveTarget(LiveArea.Home),
                LiveTarget(LiveArea.Search),
            )
            "admin" -> setOf(LiveTarget(LiveArea.Admin))
            else -> null
        }
    }
}

/**
 * Process-wide hub between the live stream and the state holders that show
 * data. Consumers collect [invalidations] while visible and call [lastInvalidatedAtMs]
 * when they become visible again to catch up on anything missed while hidden.
 */
class LiveInvalidationBus(private val wallClock: () -> Long = System::currentTimeMillis) {
    private val flow = MutableSharedFlow<Invalidation>(extraBufferCapacity = 64, onBufferOverflow = BufferOverflow.DROP_OLDEST)
    val invalidations: SharedFlow<Invalidation> = flow.asSharedFlow()

    private val lastByTarget = ConcurrentHashMap<LiveTarget, Long>()

    @Volatile
    private var lastEverythingMs = 0L

    fun publish(invalidation: Invalidation) {
        val at = invalidation.atLocalMs ?: wallClock()
        if (invalidation.everything) lastEverythingMs = maxOf(lastEverythingMs, at)
        invalidation.targets.forEach { target -> lastByTarget.merge(target, at, ::maxOf) }
        flow.tryEmit(invalidation)
    }

    /** Newest change (device wall clock) that affects [interest], or 0 when none. Fallback ticks are not recorded. */
    fun lastInvalidatedAtMs(interest: Set<LiveTarget>): Long {
        var latest = lastEverythingMs
        for ((target, at) in lastByTarget) if (interest.any(target::overlaps) && at > latest) latest = at
        return latest
    }

    /** Invalidations that [interest] must act on, given the start time of its latest fetch. */
    fun refetchTriggers(interest: Set<LiveTarget>, fetchStartedMs: () -> Long): Flow<Invalidation> =
        invalidations.filter { it.requiresRefetch(interest, fetchStartedMs()) }

    /** `true` when something changed since a fetch that began at [fetchStartedMs]. */
    fun isStale(interest: Set<LiveTarget>, fetchStartedMs: Long): Boolean =
        lastInvalidatedAtMs(interest) > fetchStartedMs
}

/**
 * Remembers when a state holder's latest fetch *began* (device wall clock) so
 * [LiveInvalidationBus] can drop events the fetch already covers. Call
 * [begin] immediately before issuing the request.
 */
class LiveFetchStamp(private val wallClock: () -> Long = System::currentTimeMillis) {
    @Volatile
    var startedMs: Long = 0L
        private set

    fun begin() {
        startedMs = wallClock()
    }
}
