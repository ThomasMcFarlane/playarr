package io.playarr.shared.designsystem.page

import androidx.compose.ui.Modifier
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.RowScope
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable

/** Registry key of every routed page (docs/design/page-layout.md section 4.2). */
enum class PlayarrPageId {
    Home, Library, Search, Calendar, Folders, Downloads, Watchlist, Requests, GuardianApprovals,
    Playlists, PlaylistDetail, Settings, Detail, MusicDetail, Household,

    /** Pages still on the legacy `PlayarrPageScaffold` adapter. Leaves with the adapter (A7). */
    Legacy,
}

enum class PlayarrPageBody {
    /** The rail panel: padded to the page gutters and the safe bottom. */
    Panel,

    /** Hero, detail, Home, Calendar and Folders: the body fills the screen and draws its own insets. */
    Bleed,
}

enum class PlayarrHeaderVariant { Page, Detail }

/** The header's Back control. [label] is the accessible name. */
@Immutable
data class PlayarrBack(val label: String, val onBack: () -> Unit)

@Immutable
data class PlayarrNavItem(
    val id: String,
    val label: String,
    val icon: PlayarrActionIcon?,
    /** The label pill (Today) is the group's default focus: drawn 1.055x. */
    val primary: Boolean = false,
    /** Hooks the screen owns, such as the television default-focus modifier. */
    val modifier: Modifier = Modifier,
    val onClick: () -> Unit,
)

/** What goes in the header action slot. Order is enforced by [orderedForHeader], never trusted from the caller. */
sealed interface PlayarrPageAction {
    /** A group such as the calendar's previous / today / next. Always first. */
    data class Navigation(val id: String, val items: List<PlayarrNavItem>) : PlayarrPageAction

    /** A secondary pill that toggles a panel. */
    data class Panel(
        val id: String,
        val label: String,
        val icon: PlayarrActionIcon,
        val open: Boolean,
        val onToggle: () -> Unit,
    ) : PlayarrPageAction

    /** A secondary pill that navigates (Calendar link, Customise Home). */
    data class Link(val id: String, val label: String, val icon: PlayarrActionIcon, val onClick: () -> Unit) : PlayarrPageAction

    /** The Filters pill. At most one, always last. */
    data class Filters(val label: String, val open: Boolean, val activeCount: Int, val onToggle: () -> Unit) : PlayarrPageAction

    /** A non-interactive badge (Downloads offline). */
    data class Status(val id: String, val label: String) : PlayarrPageAction

    /**
     * Transitional: a hand-built cluster that screens still pass through the legacy `PlayarrPageScaffold` slots.
     * Each screen moves onto the typed actions above in A2 and A6; the adapter and this case are deleted in A7.
     */
    data class LegacySlot(val id: String, val placement: LegacyPlacement, val content: @Composable RowScope.() -> Unit) : PlayarrPageAction
}

enum class LegacyPlacement { Navigation, Panel }

/** The canonical header order: navigation, then panel/link/status/legacy-panel in the order given, then Filters. */
fun orderedForHeader(actions: List<PlayarrPageAction>): List<PlayarrPageAction> {
    require(actions.count { it is PlayarrPageAction.Filters } <= 1) { "A page has at most one Filters action" }
    fun rank(action: PlayarrPageAction): Int = when (action) {
        is PlayarrPageAction.Navigation -> 0
        is PlayarrPageAction.LegacySlot -> if (action.placement == LegacyPlacement.Navigation) 0 else 1
        is PlayarrPageAction.Filters -> 2
        else -> 1
    }
    // sortedBy is stable, so the given order survives inside a rank.
    return actions.sortedBy(::rank)
}

@Immutable
data class PlayarrPageHeaderSpec(
    val title: String,
    val detail: String? = null,
    /** Null only on Home. */
    val back: PlayarrBack?,
    val actions: List<PlayarrPageAction> = emptyList(),
    val variant: PlayarrHeaderVariant = PlayarrHeaderVariant.Page,
    /** The settings index opens with Back drawn focused (web: inverted, enlarged). */
    val backActive: Boolean = false,
    /** Phone: the 21.6 px title (Search, Settings index). The Detail variant implies it. */
    val largeTitle: Boolean = false,
)

@Immutable
data class PlayarrEmptySpec(val message: String, val description: String? = null)

@Immutable
data class PlayarrErrorSpec(val message: String, val retryLabel: String?)

/** A state fills the body instead of the content. Exactly one of content or state. */
sealed interface PlayarrPageState {
    data class Loading(val label: String) : PlayarrPageState
    data class Empty(val spec: PlayarrEmptySpec) : PlayarrPageState
    data class Error(val spec: PlayarrErrorSpec, val onRetry: (() -> Unit)?) : PlayarrPageState
}

/** The body scope: a column, so page content keeps `weight`, alignment and the like. */
class PlayarrPageBodyScope internal constructor(scope: ColumnScope) : ColumnScope by scope
