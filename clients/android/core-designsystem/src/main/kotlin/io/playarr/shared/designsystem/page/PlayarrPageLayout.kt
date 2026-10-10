package io.playarr.shared.designsystem.page

import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.foundation.interaction.collectIsFocusedAsState
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.union
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.LocalMinimumInteractiveComponentSize
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.foundation.BorderStroke
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.playarr.shared.designsystem.theme.PlayarrWebTheme

/**
 * Phone window insets for page chrome: web `--mobile-top-inset` is `max(14px, env(safe-area-inset-top))`. The app
 * overrides this once (parity captures lay out without system-bar insets).
 */
val LocalPlayarrPhoneInsets = staticCompositionLocalOf<@Composable () -> WindowInsets> {
    { WindowInsets.safeDrawing.union(WindowInsets(top = 14.dp)) }
}

/**
 * The one page frame (docs/design/page-layout.md section 4.2): the header (Back, title, detail, ordered actions), a body
 * that stays clear of the profile chip and the navigation rail, and exactly one of the content or a state.
 *
 * Nothing here takes a `Modifier`, a colour, a size or a `TextStyle`: a page cannot move, resize or recolour the header
 * or its controls.
 *
 * @param header null only for the registry-exempt pages.
 * @param state when set, replaces [content] inside the body, so the header and Back stay up while loading, empty or failed.
 */
@Composable
fun PlayarrPageLayout(
    pageId: PlayarrPageId,
    header: PlayarrPageHeaderSpec?,
    body: PlayarrPageBody = PlayarrPageBody.Panel,
    state: PlayarrPageState? = null,
    backdrop: (@Composable BoxScope.() -> Unit)? = null,
    content: @Composable PlayarrPageBodyScope.() -> Unit,
) {
    val tv = LocalPlayarrFormFactor.current == PlayarrFormFactor.Tv
    val metrics = PlayarrPageTokens.current()
    val panel = body == PlayarrPageBody.Panel
    val phoneInsets = LocalPlayarrPhoneInsets.current()
    val headerInsets = if (panel || tv) Modifier else Modifier.windowInsetsPadding(phoneInsets)
    val actions = header?.actions.orEmpty()
    // Television: the app shell owns one action column at the right edge (where the 30 September Filters tile sat); only the
    // period navigation stays in the header row. Phones keep every action in the header row.
    val ordered = orderedForHeader(actions)
    val headerActions = if (tv) ordered.filter { it is PlayarrPageAction.Navigation } else ordered
    val columnActions = if (tv) ordered - headerActions.toSet() else emptyList()
    Box(
        Modifier
            .fillMaxSize()
            .background(PlayarrWebTheme.palette.surface)
            .then(if (tv || !panel) Modifier else Modifier.windowInsetsPadding(phoneInsets))
            .semantics { pageIdTag = pageId },
    ) {
        backdrop?.invoke(this)
        Column(
            if (panel) {
                val detailExtra = if (header?.detail != null) (if (tv) 22.dp else 18.dp) else 0.dp
                Modifier
                    .fillMaxSize()
                    .padding(
                        start = metrics.start,
                        end = metrics.bodyEnd,
                        top = metrics.bodyTop + detailExtra,
                        bottom = metrics.safeBottom,
                    )
            } else {
                Modifier.fillMaxSize()
            },
        ) {
            if (state != null) PlayarrPageStateBody(state) else content(PlayarrPageBodyScope(this))
        }
        if (header != null) {
            PlayarrPageHeaderRow(
                spec = header,
                modifier = Modifier
                    .align(Alignment.TopStart)
                    .then(headerInsets)
                    // The row centres its items on the action tile: Back drops by half the difference.
                    .padding(start = metrics.start, top = if (headerActions.isNotEmpty() && !tv) metrics.headerTop + (metrics.headerHeight - metrics.control) / 2 else metrics.headerTop),
            )
            if (headerActions.isNotEmpty()) {
                PlayarrPageActions(
                    actions = headerActions,
                    modifier = Modifier.align(Alignment.TopEnd).then(headerInsets),
                )
            }
            if (columnActions.isNotEmpty()) PlayarrShellActionColumn(columnActions, Modifier.align(Alignment.TopEnd))
        }
    }
}

/**
 * The one right-hand header cluster, one row: navigation first, then the secondary pills in the order given, then
 * Filters last, so Filters sits in the identical spot on every page. The caller's order is not trusted.
 */
@Composable
internal fun PlayarrPageActions(actions: List<PlayarrPageAction>, modifier: Modifier = Modifier) {
    val tv = LocalPlayarrFormFactor.current == PlayarrFormFactor.Tv
    val metrics = PlayarrPageTokens.current()
    Row(
        // On phones the profile chip is pinned top-right, so the cluster stops short of it.
        modifier.padding(end = metrics.headerEnd, top = metrics.headerTop),
        // Phones: the web shell column is a row of tiles with an 8 px gap; on TV the header row only holds the period navigation.
        horizontalArrangement = Arrangement.spacedBy(if (tv) 0.dp else metrics.actionsGap),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        orderedForHeader(actions).forEach { action ->
            when (action) {
                is PlayarrPageAction.Navigation -> Row(Modifier.padding(end = if (tv) 0.dp else 25.dp), horizontalArrangement = Arrangement.spacedBy(4.dp), verticalAlignment = Alignment.CenterVertically) {
                    action.items.forEach { item -> PlayarrNavButton(item) }
                }
                is PlayarrPageAction.Panel -> PlayarrActionPill(action.icon, action.label, action.onToggle, active = action.open)
                is PlayarrPageAction.Link -> PlayarrActionPill(action.icon, action.label, action.onClick)
                is PlayarrPageAction.Filters -> PlayarrActionPill(PlayarrActionIcon.Filters, action.label, action.onToggle, active = action.open, count = action.activeCount)
                is PlayarrPageAction.Status -> PlayarrStatusBadge(action.label)
            }
        }
    }
}

/** The round period arrow (glyph) or the label pill (Today) of a navigation group. They stay round (owner decision Q10). */
@Composable
private fun PlayarrNavButton(item: PlayarrNavItem) {
    val palette = PlayarrWebTheme.palette
    val tv = LocalPlayarrFormFactor.current == PlayarrFormFactor.Tv
    val height = PlayarrPageTokens.current().control
    val glyph = item.icon?.glyph
    val source = remember { MutableInteractionSource() }
    val focused by source.collectIsFocusedAsState()
    CompositionLocalProvider(LocalMinimumInteractiveComponentSize provides Dp.Unspecified) {
        Surface(
            onClick = item.onClick,
            interactionSource = source,
            shape = CircleShape,
            color = palette.surface,
            contentColor = palette.inkSoft,
            border = BorderStroke(1.dp, palette.pillBorder),
            // Label pills (Today, the calendar date range) size to their label from the 92 / 76 dp minimum (web `.ui-btn`).
            modifier = (if (glyph != null) Modifier.size(height) else Modifier.widthIn(min = if (tv) 92.dp else 76.dp).height(height))
                .then(item.modifier)
                .then(if (item.primary) Modifier.graphicsLayer { scaleX = 1.055f; scaleY = 1.055f } else Modifier)
                // The ring is the focus state (white in dark, ink in light), never alongside another ring and never a fill.
                .then(if (focused) Modifier.playarrFocusRing(PlayarrRingShape.Round) else Modifier)
                .semantics { contentDescription = item.label },
        ) {
            Box(contentAlignment = Alignment.Center) {
                if (glyph != null) Text(glyph, fontSize = 13.sp, fontWeight = FontWeight(720))
                else Text(item.label, fontSize = 14.4.sp, fontWeight = FontWeight(720), maxLines = 1, modifier = Modifier.padding(horizontal = 20.dp))
            }
        }
    }
}

/** A non-interactive badge in the action slot (Downloads offline). */
@Composable
private fun PlayarrStatusBadge(label: String) {
    val palette = PlayarrWebTheme.palette
    Surface(
        shape = CircleShape,
        color = palette.surface,
        contentColor = palette.inkSoft,
        border = BorderStroke(1.dp, palette.pillBorder),
    ) {
        Text(label, fontSize = 12.sp, fontWeight = FontWeight(720), modifier = Modifier.padding(horizontal = 14.dp, vertical = 8.dp))
    }
}

/**
 * The shell action column (television): every page's side-panel and action pills stacked vertically at the right edge,
 * panel openers above, Filters last (owner ruling, 8 October 2026; web `.shell-action-column`).
 */
@Composable
private fun PlayarrShellActionColumn(actions: List<PlayarrPageAction>, modifier: Modifier = Modifier) {
    val metrics = PlayarrPageTokens.current()
    Column(
        modifier.padding(top = metrics.shellColumnTop, end = metrics.shellColumnEdge),
        verticalArrangement = Arrangement.spacedBy(metrics.shellColumnGap),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        actions.forEach { action ->
            when (action) {
                is PlayarrPageAction.Panel -> PlayarrActionPill(action.icon, action.label, action.onToggle, active = action.open)
                is PlayarrPageAction.Link -> PlayarrActionPill(action.icon, action.label, action.onClick)
                is PlayarrPageAction.Filters -> PlayarrActionPill(PlayarrActionIcon.Filters, action.label, action.onToggle, active = action.open, count = action.activeCount)
                is PlayarrPageAction.Status -> PlayarrStatusBadge(action.label)
                is PlayarrPageAction.Navigation -> Unit
            }
        }
    }
}
