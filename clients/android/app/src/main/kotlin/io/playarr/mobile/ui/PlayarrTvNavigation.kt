package io.playarr.mobile.ui

import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.grid.LazyGridState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEvent
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.layout.LayoutCoordinates
import androidx.compose.ui.layout.boundsInRoot
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.runtime.compositionLocalOf
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import androidx.compose.runtime.withFrameNanos

/*
 * Android TV D-pad navigation, ported from the web TV client (clients/tv-web/web/src/lib/useTvNavigation.ts,
 * focusGeometry.ts, trackNavigation.ts). The web client decides every move itself instead of leaving it to the
 * browser, and so does this file, for the places where Compose's own 2D focus search disagrees with the web:
 *
 *   Rails (Home, series detail tracks): LEFT/RIGHT step through the rail in order. RIGHT at the last card is a
 *   hard stop. LEFT at the first card goes to the navigation rail's current item. UP/DOWN go to the previous/next
 *   non-empty rail: Home lands on the same card index (clamped to the last card), detail tracks land on the card
 *   whose centre is closest horizontally. DOWN at the last rail stays put. UP at the first rail goes to the
 *   page's top control when there is one above the card.
 *
 *   Grids (Movies, Series): index arithmetic over the columns (web `titleGridNeighbourIndex`). DOWN on an
 *   incomplete last row lands on the final card. LEFT in the first column goes to the navigation rail, RIGHT in
 *   the last column goes to the alphabet strip.
 *
 * Why this exists: a focused Compose card is lifted by a few dp (web `translateY(-6px)`) through a graphics
 * layer, and Compose's 2D search measures the lifted bounds. A lifted neighbour in the same row therefore sits
 * "below" its un-lifted sibling, beats the next rail as the DOWN candidate, and focus oscillates sideways forever.
 * Explicit index navigation does not depend on pixel geometry at all.
 */

internal enum class TvDirection { Up, Down, Left, Right }

internal fun Key.toTvDirection(): TvDirection? = when (this) {
    Key.DirectionUp -> TvDirection.Up
    Key.DirectionDown -> TvDirection.Down
    Key.DirectionLeft -> TvDirection.Left
    Key.DirectionRight -> TvDirection.Right
    else -> null
}

/** Plain rectangle so the geometry stays JVM-testable. */
internal data class TvRect(val left: Float, val top: Float, val right: Float, val bottom: Float) {
    val width: Float get() = right - left
    val height: Float get() = bottom - top
    val centreX: Float get() = left + width / 2f
    val centreY: Float get() = top + height / 2f
}

/** Web `scoreDirectionalCandidate`: lower is better, null when the candidate is outside the forward cone. */
internal fun tvScoreCandidate(from: TvRect, to: TvRect, direction: TvDirection): Float? {
    val dx = to.centreX - from.centreX
    val dy = to.centreY - from.centreY
    val vertical = direction == TvDirection.Up || direction == TvDirection.Down
    val forward = when (direction) {
        TvDirection.Up -> dy < -2f
        TvDirection.Down -> dy > 2f
        TvDirection.Left -> dx < -2f
        TvDirection.Right -> dx > 2f
    }
    if (!forward) return null
    val primary = abs(if (vertical) dy else dx)
    val lateral = abs(if (vertical) dx else dy)
    val overlap = if (vertical) {
        max(0f, min(from.right, to.right) - max(from.left, to.left))
    } else {
        max(0f, min(from.bottom, to.bottom) - max(from.top, to.top))
    }
    val crossAxis = if (vertical) min(from.width, to.width) else min(from.height, to.height)
    val cone = primary * 0.85f + crossAxis * 0.2f
    if (overlap <= 0f && lateral > cone) return null
    return primary + lateral * 4f - min(overlap, 180f) * 0.55f
}

/** Web `pickBestDirectionalTarget`. */
internal fun <T> tvPickBest(from: TvRect, candidates: List<Pair<T, TvRect>>, direction: TvDirection): T? {
    var best: T? = null
    var bestScore = Float.POSITIVE_INFINITY
    for ((item, rect) in candidates) {
        val score = tvScoreCandidate(from, rect, direction) ?: continue
        if (score >= bestScore) continue
        bestScore = score
        best = item
    }
    return best
}

/** Web `titleGridNeighbourIndex`; null means the press leaves the grid. */
internal fun tvGridNeighbour(index: Int, length: Int, columns: Int, direction: TvDirection): Int? {
    if (index < 0 || index >= length || columns < 1 || length == 0) return null
    val column = index % columns
    return when (direction) {
        TvDirection.Left -> if (column > 0) index - 1 else null
        TvDirection.Right -> if (column < columns - 1 && index + 1 < length) index + 1 else null
        TvDirection.Up -> if (index - columns >= 0) index - columns else null
        TvDirection.Down -> {
            val candidate = index + columns
            when {
                candidate < length -> candidate
                length - 1 > index -> length - 1
                else -> null
            }
        }
    }
}

/** Web `findClosestItemInNextTrack`: the index of the item closest horizontally to [currentCentreX]. */
internal fun tvClosestByCentreX(centres: List<Float>, currentCentreX: Float): Int? =
    centres.withIndex().minByOrNull { abs(it.value - currentCentreX) }?.index

/** What a key press resolves to for an item at [index] of a rail of [size] items. */
internal sealed interface TvMove {
    data class Focus(val rail: Int, val index: Int) : TvMove
    data object LeftEdge : TvMove
    data object UpEdge : TvMove
    data object DownEdge : TvMove
    data object Stay : TvMove
}

/**
 * Rail rules (see the file comment). [sizes] is the item count of every rail, empty rails included; [targetIndex]
 * picks the index inside the destination rail for UP/DOWN.
 */
internal fun tvRailMove(
    rail: Int,
    index: Int,
    direction: TvDirection,
    sizes: List<Int>,
    targetIndex: (targetRail: Int, targetSize: Int) -> Int,
): TvMove {
    val size = sizes.getOrElse(rail) { 0 }
    return when (direction) {
        TvDirection.Left -> if (index > 0) TvMove.Focus(rail, index - 1) else TvMove.LeftEdge
        TvDirection.Right -> if (index < size - 1) TvMove.Focus(rail, index + 1) else TvMove.Stay
        TvDirection.Up, TvDirection.Down -> {
            val step = if (direction == TvDirection.Down) 1 else -1
            var next = rail + step
            while (next in sizes.indices && sizes[next] == 0) next += step
            if (next !in sizes.indices) {
                if (direction == TvDirection.Up) TvMove.UpEdge else TvMove.DownEdge
            } else {
                TvMove.Focus(next, targetIndex(next, sizes[next]).coerceIn(0, sizes[next] - 1))
            }
        }
    }
}

/**
 * The navigation rail's entry the page should return to (web: the `aria-current` item, else the first). Provided by
 * the television shell; null elsewhere, in which case LEFT falls back to Compose's own search.
 */
internal val LocalTvNavEntry = compositionLocalOf<FocusRequester?> { null }

/** Whether anything in the app currently holds D-pad focus (the shell tracks it on its root). */
internal val LocalTvHasFocus = compositionLocalOf<() -> Boolean> { { false } }

/** Whether the navigation rail holds focus (the shell tracks it): on a page's first frame that is only the automatic restore. */
internal val LocalTvNavHasFocus = compositionLocalOf<() -> Boolean> { { false } }

/**
 * A page's default focus (web `data-tv-focus-default`): runs [block] once the window has input focus and nothing in the
 * app holds focus, so a cold start, a warm start from the launcher and a return from playback all land on the page's
 * content instead of on the first navigation item.
 */
@Composable
internal fun TvDefaultFocusEffect(key: Any?, block: suspend () -> Unit) {
    val windowFocused = androidx.compose.ui.platform.LocalWindowInfo.current.isWindowFocused
    val hasFocus = LocalTvHasFocus.current
    val navHasFocus = LocalTvNavHasFocus.current
    // Returning from a detail page or the player, Android hands focus to the first navigation item a moment after this
    // page appears. That is not a user choice, so on the page's first run, focus that settles on the rail counts as
    // "nothing focused" and the page takes it back.
    val firstRun = androidx.compose.runtime.remember { booleanArrayOf(true) }
    androidx.compose.runtime.LaunchedEffect(key, windowFocused) {
        if (!windowFocused) return@LaunchedEffect
        val first = firstRun[0]
        firstRun[0] = false
        if (!hasFocus()) {
            block()
        } else if (first) {
            // Watch the rail for a short settle window; if it takes focus without the user having pressed anything, move it back.
            val railTookFocus = kotlinx.coroutines.withTimeoutOrNull(2_000) {
                androidx.compose.runtime.snapshotFlow { navHasFocus() }.first { it }
            }
            if (railTookFocus != null) block()
        }
    }
}

/** Shared slot registry: one focusable per (group, index), found again by key for explicit focus moves. */
internal abstract class TvSlotRegistry(protected val scope: CoroutineScope) {
    class Slot(val requester: FocusRequester) {
        var coords: LayoutCoordinates? = null
    }

    protected val slots = HashMap<Long, Slot>()
    private var moving = false

    protected fun slotKey(group: Int, index: Int): Long = group.toLong() * 1_000_000L + index

    internal fun register(group: Int, index: Int, slot: Slot) {
        slots[slotKey(group, index)] = slot
    }

    internal fun unregister(group: Int, index: Int, slot: Slot) {
        if (slots[slotKey(group, index)] === slot) slots.remove(slotKey(group, index))
    }

    protected fun slotRect(group: Int, index: Int): TvRect? =
        slots[slotKey(group, index)]?.coords?.takeIf { it.isAttached }?.boundsInRoot()
            ?.let { TvRect(it.left, it.top, it.right, it.bottom) }

    /** Brings (group, index) into composition by scrolling, then waits for its slot. */
    protected abstract suspend fun scrollInto(group: Int, index: Int)

    suspend fun focus(group: Int, index: Int): Boolean {
        var slot = slots[slotKey(group, index)]
        if (slot?.coords?.isAttached != true) {
            scrollInto(group, index)
            var frames = 0
            while (frames < 30) {
                slot = slots[slotKey(group, index)]
                if (slot?.coords?.isAttached == true) break
                withFrameNanos { }
                frames += 1
            }
        }
        // A freshly composed item, or a window that has not taken input focus yet, can refuse focus for a moment.
        var attempts = 0
        while (slot != null && attempts < 40) {
            if (runCatching { slot.requester.requestFocus() }.getOrDefault(false)) return true
            kotlinx.coroutines.delay(50)
            attempts += 1
        }
        return false
    }

    /** Runs [block] unless a previous move is still in flight, so a held key cannot start two moves from one card. */
    protected fun launchMove(block: suspend () -> Unit) {
        if (moving) return
        moving = true
        scope.launch {
            try {
                block()
            } finally {
                moving = false
            }
        }
    }
}

/** A vertical stack of horizontal rails (Home rails, series detail tracks). */
internal class TvRails(
    scope: CoroutineScope,
    private val verticalNeighbour: Vertical,
) : TvSlotRegistry(scope) {
    enum class Vertical { SameIndex, ClosestX }

    /** Item count of each rail, refreshed every composition. */
    var sizes: List<Int> = emptyList()

    /** The vertical list that holds the rails, and where in it rail [n] sits. */
    var columnState: LazyListState? = null
    var columnIndexOfRail: (Int) -> Int = { it }

    /** LEFT on the first card: usually focuses the navigation rail. */
    var onLeftEdge: () -> Boolean = { false }

    /** UP on the first rail: focus a control above the card if there is one; true when focus moved. */
    var onUpEdge: (TvRect) -> Boolean = { false }

    /** DOWN on the last rail: true lets Compose carry on below the rails (series detail credits and similar titles). */
    var downFallsThrough: Boolean = false

    private val rowStates = HashMap<Int, LazyListState>()
    fun rowState(rail: Int): LazyListState = rowStates.getOrPut(rail) { LazyListState() }

    override suspend fun scrollInto(group: Int, index: Int) {
        val anyComposed = slots.keys.any { it / 1_000_000L == group.toLong() }
        if (!anyComposed) columnState?.scrollToItem(columnIndexOfRail(group))
        rowState(group).scrollToItem(index)
    }

    private fun targetIndex(fromRail: Int, fromIndex: Int, targetRail: Int, targetSize: Int): Int =
        when (verticalNeighbour) {
            Vertical.SameIndex -> fromIndex
            Vertical.ClosestX -> {
                val from = slotRect(fromRail, fromIndex)?.centreX
                val composed = (0 until targetSize).mapNotNull { i -> slotRect(targetRail, i)?.let { i to it.centreX } }
                if (from == null || composed.isEmpty()) {
                    fromIndex
                } else {
                    composed.minBy { abs(it.second - from) }.first
                }
            }
        }

    fun onKey(rail: Int, index: Int, event: KeyEvent): Boolean {
        val direction = event.key.toTvDirection() ?: return false
        if (event.type != KeyEventType.KeyDown) return true
        val from = slotRect(rail, index)
        val move = tvRailMove(rail, index, direction, sizes) { r, s -> targetIndex(rail, index, r, s) }
        when (move) {
            is TvMove.Focus -> launchMove { focus(move.rail, move.index) }
            TvMove.LeftEdge -> if (!onLeftEdge()) return false
            TvMove.UpEdge -> if (from == null || !onUpEdge(from)) return true
            TvMove.DownEdge -> if (downFallsThrough) return false
            TvMove.Stay -> Unit
        }
        return true
    }
}

/** A grid of cards (Movies, Series): web index arithmetic, with explicit exits at the left and right edges. */
internal class TvGrid(scope: CoroutineScope) : TvSlotRegistry(scope) {
    var gridState: LazyGridState? = null
    var count: Int = 0
    var fixedColumns: Int? = null

    /** LEFT in the first column. */
    var onLeftEdge: () -> Boolean = { false }

    /** RIGHT in the last column (the alphabet strip). */
    var onRightEdge: () -> Boolean = { false }

    private fun columns(): Int {
        fixedColumns?.let { return it }
        val visible = gridState?.layoutInfo?.visibleItemsInfo.orEmpty()
        return max(1, (visible.maxOfOrNull { it.column } ?: 0) + 1)
    }

    override suspend fun scrollInto(group: Int, index: Int) {
        gridState?.scrollToItem(index)
    }

    fun onKey(index: Int, event: KeyEvent): Boolean {
        val direction = event.key.toTvDirection() ?: return false
        if (event.type != KeyEventType.KeyDown) return true
        val next = tvGridNeighbour(index, count, columns(), direction)
        if (next != null) {
            launchMove { focus(0, next) }
            return true
        }
        return when (direction) {
            TvDirection.Left -> onLeftEdge()
            TvDirection.Right -> onRightEdge() || true
            TvDirection.Up -> false
            TvDirection.Down -> true
        }
    }
}

/** Makes this item a stop of [rails]: registers it, and routes the D-pad through the rail rules. */
@Composable
internal fun Modifier.tvRailItem(rails: TvRails, rail: Int, index: Int): Modifier {
    val slot = remember(rails, rail, index) { TvSlotRegistry.Slot(FocusRequester()) }
    DisposableEffect(slot) {
        rails.register(rail, index, slot)
        onDispose { rails.unregister(rail, index, slot) }
    }
    return this
        .onPreviewKeyEvent { rails.onKey(rail, index, it) }
        .focusRequester(slot.requester)
        .onGloballyPositioned { slot.coords = it }
}

/** Makes this item cell [index] of [grid]. */
@Composable
internal fun Modifier.tvGridItem(grid: TvGrid, index: Int): Modifier {
    val slot = remember(grid, index) { TvSlotRegistry.Slot(FocusRequester()) }
    DisposableEffect(slot) {
        grid.register(0, index, slot)
        onDispose { grid.unregister(0, index, slot) }
    }
    return this
        .onPreviewKeyEvent { grid.onKey(index, it) }
        .focusRequester(slot.requester)
        .onGloballyPositioned { slot.coords = it }
}

/**
 * The tile a series page opens on (web `nextUpSelection`): the episode the resume plan, which also drives the Play
 * button, points at, as (season number, episode id). With no plan, or a target that is not playable here, it is
 * the first playable episode (S1E1 when nothing has been watched). Null when the series has no playable episode.
 */
internal fun playarrNextUpSelection(
    seasons: List<io.playarr.shared.data.model.SeasonDetail>,
    plan: io.playarr.shared.data.model.ResumePlan?,
    seriesWorkId: String,
): Pair<Int, String>? {
    val playable = seasons.flatMap { season -> season.episodes.filter { it.mediaFileId != null }.map { season to it } }
    val target = plan?.takeIf { it.seriesWorkId == seriesWorkId }?.target
    val match = target?.let { t ->
        playable.firstOrNull { it.second.episode.id == t.episodeId }
            ?: playable.firstOrNull { it.second.mediaFileId == t.mediaFileId }
    }
    val chosen = match ?: playable.firstOrNull() ?: return null
    return chosen.first.season.seasonNumber to chosen.second.episode.id
}
