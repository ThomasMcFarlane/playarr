package io.playarr.mobile.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

/**
 * The shell action column (web `ShellActionColumn`, owner ruling 8 October 2026, row 801/890): every side-panel and action
 * button of a page (Create, Calendar link, Filters, ...) is drawn by the app shell in ONE column at the right edge, stacked
 * vertically with Filters last, where the 30 September launcher sat. Pages register their buttons through
 * [PlayarrHeaderActions] and never draw or position them.
 *
 * Geometry at the 1920x1080 TV layout (1 dp = 1 px): `right: clamp(5, 0.65vw, 14)` = 12.48, `width: clamp(48, 3.6vw, 62)` = 62,
 * `top: clamp(116, 14vh, 164)` = 151.2, gap `clamp(10, 1.2vh, 16)` = 12.96.
 */
internal class ShellActionColumnState {
    /** The registering page's buttons, or null when it has none. Written by [RegisterShellActions]. */
    var entry by mutableStateOf<ShellActions?>(null)
        internal set
    internal var owner: Any? = null
}

internal class ShellActions(
    val panelActions: (@Composable RowScope.() -> Unit)?,
    val filters: PlayarrFilterAction?,
)

internal val LocalShellActionColumn = compositionLocalOf<ShellActionColumnState?> { null }

/** Registers this page's buttons in the shell column while it is composed; they leave with the page. */
@Composable
internal fun RegisterShellActions(
    column: ShellActionColumnState,
    panelActions: (@Composable RowScope.() -> Unit)?,
    filters: PlayarrFilterAction?,
) {
    val token = remember { Any() }
    SideEffect {
        column.owner = token
        column.entry = if (panelActions == null && filters == null) null else ShellActions(panelActions, filters)
    }
    DisposableEffect(column, token) {
        onDispose {
            if (column.owner === token) {
                column.owner = null
                column.entry = null
            }
        }
    }
}

/** The column itself: place it once in the television shell, over the page. */
@Composable
internal fun ShellActionColumn(state: ShellActionColumnState, modifier: Modifier = Modifier) {
    val entry = state.entry ?: return
    Column(
        modifier.padding(top = 151.2.dp, end = 12.48.dp).width(62.dp),
        verticalArrangement = Arrangement.spacedBy(12.96.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        entry.panelActions?.let { actions -> Row(content = actions) }
        entry.filters?.let { filters ->
            PlayarrHeaderButton(
                label = filters.label,
                icon = PlayarrWebIcons.Filters,
                isTelevision = true,
                active = filters.active,
                badge = filters.badge,
                onClick = filters.onClick,
            )
        }
    }
}
