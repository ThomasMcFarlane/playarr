package io.playarr.mobile.ui

import androidx.compose.foundation.ScrollState
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
import androidx.compose.ui.unit.dp
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
    content: LazyListScope.() -> Unit,
) {
    LazyRow(
        modifier = if (fade != null) modifier.playarrScrollFade(state, vertical = false, kind = fade) else modifier,
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
