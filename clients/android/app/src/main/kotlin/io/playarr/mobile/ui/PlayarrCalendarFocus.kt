package io.playarr.mobile.ui

import androidx.compose.foundation.ScrollState
import androidx.compose.foundation.relocation.BringIntoViewRequester
import androidx.compose.foundation.relocation.bringIntoViewRequester
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.RoundRect
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.clipPath
import androidx.compose.ui.graphics.drawscope.withTransform
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.semantics.SemanticsPropertyKey
import androidx.compose.ui.semantics.SemanticsPropertyReceiver
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import io.playarr.shared.data.model.CalendarAction
import io.playarr.shared.data.model.CalendarEntry
import kotlinx.coroutines.launch

/*
 * Calendar focus rules shared with web TV (clients/tv-web/web, `data-tv-nav-geometric` on the week and month
 * tracks), written as pure functions so they are unit-tested without a device:
 *
 *  - Week:   LEFT/RIGHT moves between days (skipping empty ones, landing on the same row or the nearest one),
 *            UP/DOWN moves between the entries of the day.
 *  - Month:  LEFT/RIGHT moves between neighbouring day cells, UP/DOWN between weeks. RIGHT from the last column
 *            enters the day's list, LEFT from the list returns to the grid.
 *  - Agenda and day lists: UP/DOWN moves between entries, and the agenda's details follow focus.
 *  - UP from the first row (and LEFT from the first column) leaves the grid for the header and the navigation
 *    rail; DOWN and RIGHT at the far edge are consumed so focus never jumps somewhere unrelated.
 */
internal enum class CalendarKey { Left, Right, Up, Down }

internal data class CalendarSlot(val column: Int, val row: Int)

/** Week view: [columns] holds the entry count of each day. Null means nothing further in that direction. */
internal fun calendarWeekNeighbour(columns: List<Int>, from: CalendarSlot, key: CalendarKey): CalendarSlot? = when (key) {
    CalendarKey.Up -> if (from.row > 0) from.copy(row = from.row - 1) else null
    CalendarKey.Down -> if (from.row < (columns.getOrElse(from.column) { 0 }) - 1) from.copy(row = from.row + 1) else null
    CalendarKey.Left, CalendarKey.Right -> {
        val step = if (key == CalendarKey.Right) 1 else -1
        generateSequence(from.column + step) { it + step }
            .takeWhile { it in columns.indices }
            .firstOrNull { columns[it] > 0 }
            ?.let { CalendarSlot(it, from.row.coerceAtMost(columns[it] - 1)) }
    }
}

/** Month grid of [columns] columns by [rows] rows, cells numbered row-major. Null leaves the grid. */
internal fun calendarMonthNeighbour(index: Int, rows: Int, columns: Int, key: CalendarKey): Int? {
    val row = index / columns
    val column = index % columns
    return when (key) {
        CalendarKey.Left -> if (column > 0) index - 1 else null
        CalendarKey.Right -> if (column < columns - 1) index + 1 else null
        CalendarKey.Up -> if (row > 0) index - columns else null
        CalendarKey.Down -> if (row < rows - 1) index + columns else null
    }
}

/** A single vertical list. */
internal fun calendarListNeighbour(index: Int, count: Int, key: CalendarKey): Int? = when (key) {
    CalendarKey.Up -> if (index > 0) index - 1 else null
    CalendarKey.Down -> if (index < count - 1) index + 1 else null
    else -> null
}

/** Whether a press that found no target in the grid is swallowed (far edges) or left to the default focus search. */
internal fun calendarConsumesAtEdge(key: CalendarKey): Boolean = key == CalendarKey.Down || key == CalendarKey.Right

private fun androidx.compose.ui.input.key.KeyEvent.calendarKey(): CalendarKey? = when (key) {
    Key.DirectionLeft -> CalendarKey.Left
    Key.DirectionRight -> CalendarKey.Right
    Key.DirectionUp -> CalendarKey.Up
    Key.DirectionDown -> CalendarKey.Down
    else -> null
}

/** D-pad handler: [move] returns true when it handled the press. Only key-down events are considered. */
internal fun Modifier.calendarDpad(move: (CalendarKey) -> Boolean): Modifier = onPreviewKeyEvent { event ->
    val key = event.calendarKey()
    if (key == null || event.type != KeyEventType.KeyDown) false else move(key)
}

// ---- Availability (the coloured left border) -------------------------------------------------------------

/**
 * Availability drives the left border of every calendar entry: do we have it (a file in the library the viewer
 * can play) or not. Never the library or the media kind. When the server listed actions, an enabled `play` or
 * `resume` is authoritative; a server that sends none falls back to `hasFile`. Same rule as web `entryAvailable`.
 */
internal fun CalendarEntry.isAvailable(): Boolean {
    if (!hasFile) return false
    if (actions.isEmpty()) return true
    return actions.any { (it.action == CalendarAction.PLAY || it.action == CalendarAction.RESUME) && it.enabled }
}

/** A series group is available only when every folded episode is. */
internal fun CalendarItem.isAvailable(): Boolean = when (this) {
    is CalendarItem.Single -> entry.isAvailable()
    is CalendarItem.Series -> entries.all { it.isAvailable() }
}

/** Web `--success` for available, `--ink-muted` for not available or upcoming (`Calendar.css`). */
internal val CalendarAvailableColor: Color get() = if (webIsDark) Color(0xFF7FC09D) else Color(0xFF347559)
internal val CalendarUnavailableColor: Color get() = WebInkMuted

internal val CalendarAvailabilityKey = SemanticsPropertyKey<String>("CalendarAvailability")
internal var SemanticsPropertyReceiver.calendarAvailability by CalendarAvailabilityKey

/** The web `.calendar-entry` / `.calendar-chip` left border: [width] wide, clipped to the entry's rounded shape. */
internal fun Modifier.calendarAvailabilityBorder(available: Boolean, radius: Dp = 12.dp, width: Dp = 4.dp): Modifier =
    this
        .semantics { calendarAvailability = if (available) "available" else "unavailable" }
        .drawWithContent {
            drawContent()
            val r = radius.toPx()
            val shape = Path().apply { addRoundRect(RoundRect(0f, 0f, size.width, size.height, CornerRadius(r))) }
            clipPath(shape) {
                drawRect(
                    color = if (available) CalendarAvailableColor else CalendarUnavailableColor,
                    topLeft = Offset.Zero,
                    size = androidx.compose.ui.geometry.Size(width.toPx(), size.height),
                )
            }
        }

// ---- Edge fades -------------------------------------------------------------------------------------------

/** Which edges of a scroll viewport currently have content beyond them (and so show the web fade). */
internal data class CalendarEdges(val top: Boolean = false, val bottom: Boolean = false, val start: Boolean = false, val end: Boolean = false) {
    override fun toString(): String = listOfNotNull(
        "top".takeIf { top }, "bottom".takeIf { bottom }, "start".takeIf { start }, "end".takeIf { end },
    ).joinToString(",")
}

internal val CalendarEdgesKey = SemanticsPropertyKey<CalendarEdges>("CalendarEdges")
internal var SemanticsPropertyReceiver.calendarEdges by CalendarEdgesKey

private val FadeInk = Color(0xFF1F0E14)

/**
 * The web rail edge fade (`.tv-scroll-edge-window`, `Calendar.css`), drawn on each side of a scroll viewport where
 * content continues: a radial shade clamp(28, 4 vh, 54) tall on the top and bottom edges (clamp(32, 3.6 vw, 58) wide
 * on the sides) at 0.58 opacity, with the same stops as web (0.42, 0.12 at 48%, clear at 78%; 0.5, 0.18 at 46% on
 * the sides). Apply it to the viewport, outside the scrolling modifier. The state is also published in semantics.
 */
@Composable
internal fun Modifier.calendarEdgeFades(edges: CalendarEdges): Modifier {
    val config = LocalConfiguration.current
    val vertical = (config.screenHeightDp * 0.04f).coerceIn(28f, 54f).dp
    val horizontal = (config.screenWidthDp * 0.036f).coerceIn(32f, 58f).dp
    return this
        .semantics { calendarEdges = edges }
        .drawWithContent {
            drawContent()
            val v = vertical.toPx()
            val h = horizontal.toPx()
            if (edges.top) drawVerticalFade(top = true, v)
            if (edges.bottom) drawVerticalFade(top = false, v)
            if (edges.start) drawHorizontalFade(start = true, h)
            if (edges.end) drawHorizontalFade(start = false, h)
        }
}

private fun androidx.compose.ui.graphics.drawscope.DrawScope.drawVerticalFade(top: Boolean, band: Float) {
    val w = size.width
    val shape = Path().apply {
        val round = CornerRadius(0.5f * w, 0.5f * band)
        addRoundRect(
            if (top) {
                RoundRect(0f, 0f, w, band, CornerRadius.Zero, CornerRadius.Zero, round, round)
            } else {
                RoundRect(0f, size.height - band, w, size.height, round, round, CornerRadius.Zero, CornerRadius.Zero)
            },
        )
    }
    val top0 = if (top) 0f else size.height - band
    // ellipse 82% 100% at 50% -25% (top) / 50% 125% (bottom)
    val centre = Offset(0.5f * w, top0 + band * if (top) -0.25f else 1.25f)
    val rx = 0.82f * w
    val ry = band
    clipPath(shape) {
        withTransform({ scale(1f, ry / rx, pivot = centre) }) {
            drawCircle(
                brush = Brush.radialGradient(
                    0f to FadeInk.copy(alpha = 0.42f * FADE_OPACITY),
                    0.48f to FadeInk.copy(alpha = 0.12f * FADE_OPACITY),
                    0.78f to Color.Transparent,
                    center = centre, radius = rx,
                ),
                radius = rx, center = centre,
            )
        }
    }
}

private fun androidx.compose.ui.graphics.drawscope.DrawScope.drawHorizontalFade(start: Boolean, band: Float) {
    val h = size.height
    val left = if (start) 0f else size.width - band
    val round = CornerRadius(0.48f * band, 0.48f * h)
    val shape = Path().apply {
        addRoundRect(
            if (start) {
                RoundRect(left, 0f, left + band, h, CornerRadius.Zero, round, round, CornerRadius.Zero)
            } else {
                RoundRect(left, 0f, left + band, h, round, CornerRadius.Zero, CornerRadius.Zero, round)
            },
        )
    }
    // ellipse 100% 88% at -28% 50% (start) / 128% 50% (end)
    val centre = Offset(left + band * if (start) -0.28f else 1.28f, h / 2f)
    val ry = 0.88f * h
    clipPath(shape) {
        withTransform({ scale(1f, ry / band, pivot = centre) }) {
            drawCircle(
                brush = Brush.radialGradient(
                    0f to FadeInk.copy(alpha = 0.5f * FADE_OPACITY),
                    0.46f to FadeInk.copy(alpha = 0.18f * FADE_OPACITY),
                    0.78f to Color.Transparent,
                    center = centre, radius = band,
                ),
                radius = band, center = centre,
            )
        }
    }
}

private const val FADE_OPACITY = 0.58f

internal fun ScrollState.verticalEdges() = CalendarEdges(top = canScrollBackward, bottom = canScrollForward)
internal fun ScrollState.horizontalEdges() = CalendarEdges(start = canScrollBackward, end = canScrollForward)
internal fun LazyListState.verticalEdges() = CalendarEdges(top = canScrollBackward, bottom = canScrollForward)

// ---- Focus plumbing --------------------------------------------------------------------------------------

/**
 * Reveals the focused entry with a margin so it never sits under an edge fade, and reports focus to [onFocused].
 * `focusable()` already asks parents to bring a focused child into view; this adds the margin explicitly so the
 * guarantee does not depend on the container.
 */
@Composable
internal fun Modifier.calendarFocusReveal(onFocused: (() -> Unit)? = null): Modifier {
    val bring = remember { BringIntoViewRequester() }
    val scope = rememberCoroutineScope()
    var size by remember { mutableStateOf(androidx.compose.ui.unit.IntSize.Zero) }
    val margin = with(androidx.compose.ui.platform.LocalDensity.current) { 32.dp.toPx() }
    return this
        .bringIntoViewRequester(bring)
        .onSizeChanged { size = it }
        .onFocusChanged { state ->
            if (state.hasFocus) {
                scope.launch {
                    bring.bringIntoView(
                        androidx.compose.ui.geometry.Rect(-margin, -margin, size.width + margin, size.height + margin),
                    )
                }
                onFocused?.invoke()
            }
        }
}

/**
 * Focus control for one vertical [LazyListState] list (the agenda, and a month day's list). Rows are laid out lazily,
 * so a target that is not composed yet is scrolled in first and then focused from inside its own composition.
 */
internal class CalendarListFocus(
    /** Item keys in visual order. */
    val keys: List<String>,
    /** Lazy-list index of each item key (headings occupy indices of their own). */
    private val lazyIndex: Map<String, Int>,
    /** Lazy-list index to reveal instead when moving up onto an item (its day heading). */
    private val revealIndex: Map<String, Int>,
    val state: LazyListState,
    private val scope: kotlinx.coroutines.CoroutineScope,
) {
    var pending by mutableStateOf<String?>(null)

    fun focus(key: String) {
        val target = lazyIndex[key] ?: return
        val reveal = revealIndex[key] ?: target
        val info = state.layoutInfo
        val visible = info.visibleItemsInfo.firstOrNull { it.index == reveal }
        val hidden = visible == null || visible.offset < 0 || visible.offset + visible.size > info.viewportEndOffset
        pending = key
        if (hidden) scope.launch { state.scrollToItem(reveal) }
    }

    /** Handles UP/DOWN from the item at [index]; false hands the press to the default search. */
    fun move(index: Int, key: CalendarKey): Boolean {
        if (key == CalendarKey.Left) return false
        if (key == CalendarKey.Right) return false
        val target = calendarListNeighbour(index, keys.size, key)
        if (target != null) {
            focus(keys[target])
            return true
        }
        return key == CalendarKey.Down
    }
}

@Composable
internal fun rememberCalendarListFocus(
    keys: List<String>,
    lazyIndex: Map<String, Int>,
    revealIndex: Map<String, Int>,
    state: LazyListState,
): CalendarListFocus {
    val scope = rememberCoroutineScope()
    return remember(keys, lazyIndex, revealIndex, state) { CalendarListFocus(keys, lazyIndex, revealIndex, state, scope) }
}

/**
 * Makes one list row a D-pad stop: UP/DOWN through [CalendarListFocus], an optional [onSide] for LEFT/RIGHT,
 * focus requested from the row once a pending move targets it, and the focused row revealed. [onFocused] runs on focus.
 */
@Composable
internal fun Modifier.calendarListRow(
    focus: CalendarListFocus,
    key: String,
    onSide: ((CalendarKey) -> Boolean)? = null,
    onFocused: (() -> Unit)? = null,
): Modifier {
    val requester = remember { FocusRequester() }
    val index = focus.keys.indexOf(key)
    LaunchedEffect(focus.pending) {
        if (focus.pending == key) {
            runCatching { requester.requestFocus() }
            focus.pending = null
        }
    }
    return this
        .focusRequester(requester)
        .calendarDpad { pressed ->
            if (pressed == CalendarKey.Left || pressed == CalendarKey.Right) onSide?.invoke(pressed) ?: false
            else focus.move(index, pressed)
        }
        .calendarFocusReveal(onFocused)
}
