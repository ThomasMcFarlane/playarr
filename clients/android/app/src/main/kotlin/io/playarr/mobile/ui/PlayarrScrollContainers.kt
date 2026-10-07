package io.playarr.mobile.ui

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.gestures.BringIntoViewSpec
import androidx.compose.foundation.gestures.LocalBringIntoViewSpec
import androidx.compose.foundation.ScrollState
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.remember
import androidx.compose.foundation.layout.calculateStartPadding
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.foundation.gestures.FlingBehavior
import androidx.compose.foundation.gestures.ScrollableDefaults
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyGridScope
import androidx.compose.foundation.lazy.grid.LazyGridState
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.rememberLazyGridState
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.ui.layout.layout
import androidx.compose.ui.unit.constrainWidth
import androidx.compose.ui.platform.LocalConfiguration
import io.playarr.shared.designsystem.component.playarrRailFade
import io.playarr.shared.designsystem.component.PlayarrFadeKind
import io.playarr.shared.designsystem.component.playarrScrollFade

/*
 * Every scrollable container in the app is one of these. They are the platform containers plus the web client's
 * scroll-edge fade (`playarrScrollFade`, core-designsystem): a soft shadow on each edge that still has content
 * beyond it, in both themes, on television and phone. PlayarrScrollContainerUsageTest fails the build when a raw
 * LazyColumn, LazyRow, LazyVerticalGrid, verticalScroll or horizontalScroll appears anywhere else, so no screen can
 * add a scroller without the fade. [fade] picks the web-sized variant (null draws none).
 */

@Composable
internal fun PlayarrLazyColumn(
    modifier: Modifier = Modifier,
    state: LazyListState = rememberLazyListState(),
    contentPadding: PaddingValues = PaddingValues(0.dp),
    reverseLayout: Boolean = false,
    verticalArrangement: Arrangement.Vertical = if (!reverseLayout) Arrangement.Top else Arrangement.Bottom,
    horizontalAlignment: Alignment.Horizontal = Alignment.Start,
    flingBehavior: FlingBehavior = ScrollableDefaults.flingBehavior(),
    userScrollEnabled: Boolean = true,
    fade: PlayarrFadeKind? = PlayarrFadeKind.Panel,
    content: LazyListScope.() -> Unit,
) {
    LazyColumn(
        modifier = if (fade != null) modifier.playarrScrollFade(state, vertical = true, kind = fade) else modifier,
        state = state,
        contentPadding = contentPadding,
        reverseLayout = reverseLayout,
        verticalArrangement = verticalArrangement,
        horizontalAlignment = horizontalAlignment,
        flingBehavior = flingBehavior,
        userScrollEnabled = userScrollEnabled,
        content = content,
    )
}

/**
 * Brings a focused item into view by scrolling only as far as it takes to unclip it (owner rule: a rail never scrolls to a
 * matching index or offset; it moves just enough). An item already fully inside the visible span, which starts [startInset]
 * px from the viewport start (the rail's fade gutter), does not move the rail at all.
 */
@OptIn(ExperimentalFoundationApi::class)
internal class MinimalBringIntoViewSpec(private val startInset: Float) : BringIntoViewSpec {
    override fun calculateScrollDistance(offset: Float, size: Float, containerSize: Float): Float {
        val end = offset + size
        return when {
            offset >= startInset && end <= containerSize -> 0f
            size > containerSize - startInset -> offset - startInset
            offset < startInset -> offset - startInset
            else -> end - containerSize
        }
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
internal fun PlayarrLazyRow(
    modifier: Modifier = Modifier,
    state: LazyListState = rememberLazyListState(),
    contentPadding: PaddingValues = PaddingValues(0.dp),
    reverseLayout: Boolean = false,
    horizontalArrangement: Arrangement.Horizontal = if (!reverseLayout) Arrangement.Start else Arrangement.End,
    verticalAlignment: Alignment.Vertical = Alignment.Top,
    flingBehavior: FlingBehavior = ScrollableDefaults.flingBehavior(),
    userScrollEnabled: Boolean = true,
    fade: PlayarrFadeKind? = PlayarrFadeKind.Rail,
    /** The rail's viewport extent left of its content start line; non-null fades scrolled-past cards over that gutter only. */
    startGutter: Dp? = null,
    content: LazyListScope.() -> Unit,
) {
    val density = LocalDensity.current
    val spec = remember(startGutter, density) { MinimalBringIntoViewSpec(with(density) { (startGutter ?: contentPadding.calculateStartPadding(androidx.compose.ui.unit.LayoutDirection.Ltr)).toPx() }) }
    CompositionLocalProvider(LocalBringIntoViewSpec provides spec) {
    LazyRow(
        modifier = when {
            fade == null -> modifier
            startGutter != null -> modifier.playarrRailFade(state, startGutter, fade)
            else -> modifier.playarrScrollFade(state, vertical = false, kind = fade)
        },
        state = state,
        contentPadding = contentPadding,
        reverseLayout = reverseLayout,
        horizontalArrangement = horizontalArrangement,
        verticalAlignment = verticalAlignment,
        flingBehavior = flingBehavior,
        userScrollEnabled = userScrollEnabled,
        content = content,
    )
    }
}

@Composable
internal fun PlayarrLazyVerticalGrid(
    columns: GridCells,
    modifier: Modifier = Modifier,
    state: LazyGridState = rememberLazyGridState(),
    contentPadding: PaddingValues = PaddingValues(0.dp),
    reverseLayout: Boolean = false,
    verticalArrangement: Arrangement.Vertical = if (!reverseLayout) Arrangement.Top else Arrangement.Bottom,
    horizontalArrangement: Arrangement.Horizontal = Arrangement.Start,
    flingBehavior: FlingBehavior = ScrollableDefaults.flingBehavior(),
    userScrollEnabled: Boolean = true,
    fade: PlayarrFadeKind? = PlayarrFadeKind.Grid,
    content: LazyGridScope.() -> Unit,
) {
    LazyVerticalGrid(
        columns = columns,
        modifier = if (fade != null) modifier.playarrScrollFade(state, vertical = true, kind = fade) else modifier,
        state = state,
        contentPadding = contentPadding,
        reverseLayout = reverseLayout,
        verticalArrangement = verticalArrangement,
        horizontalArrangement = horizontalArrangement,
        flingBehavior = flingBehavior,
        userScrollEnabled = userScrollEnabled,
        content = content,
    )
}

/** `verticalScroll` with the scroll-edge fade; the fade is drawn on the viewport, outside the scrolled content. */
@Composable
internal fun Modifier.playarrVerticalScroll(
    state: ScrollState = rememberScrollState(),
    fade: PlayarrFadeKind? = PlayarrFadeKind.Panel,
): Modifier = (if (fade != null) playarrScrollFade(state, vertical = true, kind = fade) else this).verticalScroll(state)

/** `horizontalScroll` with the scroll-edge fade. */
@Composable
internal fun Modifier.playarrHorizontalScroll(
    state: ScrollState = rememberScrollState(),
    fade: PlayarrFadeKind? = PlayarrFadeKind.Rail,
): Modifier = (if (fade != null) playarrScrollFade(state, vertical = false, kind = fade) else this).horizontalScroll(state)

/** Web `--tv-track-left-fade`: `clamp(88px, 8.8vw, 152px)`, the gutter a television rail's viewport extends into. */
@Composable
internal fun tvTrackGutter(): Dp = (LocalConfiguration.current.screenWidthDp * 0.088f).coerceIn(88f, 152f).dp

/** Lets this element's box extend [by] to the left of where its parent places it, ending at the same right edge. */
internal fun Modifier.extendStart(by: Dp): Modifier = layout { measurable, constraints ->
    val extra = by.roundToPx()
    val placeable = measurable.measure(constraints.copy(minWidth = constraints.minWidth + extra, maxWidth = if (constraints.hasBoundedWidth) constraints.maxWidth + extra else constraints.maxWidth))
    layout(constraints.constrainWidth(placeable.width - extra), placeable.height) { placeable.place(-extra, 0) }
}
