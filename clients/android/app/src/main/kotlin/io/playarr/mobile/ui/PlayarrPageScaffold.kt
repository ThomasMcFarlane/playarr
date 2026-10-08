package io.playarr.mobile.ui

import io.playarr.shared.designsystem.page.PlayarrBack
import io.playarr.shared.designsystem.page.PlayarrEmptySpec
import io.playarr.shared.designsystem.page.PlayarrErrorSpec
import io.playarr.shared.designsystem.page.PlayarrEmptyState
import io.playarr.shared.designsystem.page.PlayarrErrorState
import io.playarr.shared.designsystem.page.PlayarrPageAction
import io.playarr.shared.designsystem.page.PlayarrPageState
import io.playarr.shared.designsystem.page.PlayarrPageBody
import io.playarr.shared.designsystem.page.PlayarrPageHeaderSpec
import io.playarr.shared.designsystem.page.PlayarrPageId
import io.playarr.shared.designsystem.page.PlayarrPageLayout
import io.playarr.shared.designsystem.icons.PlayarrWebIcons
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsFocusedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.asPaddingValues
import androidx.compose.foundation.layout.union
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.Tune
import androidx.compose.material3.Icon
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import io.playarr.shared.designsystem.component.PlayarrButton
import io.playarr.shared.designsystem.component.PlayarrButtonSize
import io.playarr.shared.designsystem.component.PlayarrButtonVariant
import io.playarr.shared.designsystem.component.PlayarrIconButton
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties

/*
 * Transitional adapter. Every routed screen still calls [PlayarrPageScaffold]; it now only builds a header spec and
 * delegates to the shared page layout in `core-designsystem` (`PlayarrPageLayout`). Screens move onto the typed
 * `PlayarrPageAction`s as the migration proceeds (docs/design/page-layout.md section 8) and this adapter goes in A7.
 */

@Composable
internal fun PlayarrPageScaffold(
    title: String,
    onBack: () -> Unit,
    isTelevision: Boolean,
    modifier: Modifier = Modifier,
    /** The page's registry id; pages not yet migrated pass nothing and stay [PlayarrPageId.Legacy]. */
    pageId: PlayarrPageId = PlayarrPageId.Legacy,
    subtitle: String? = null,
    /** The page's Filters action; drawn by the one shared page header so every page matches. */
    filters: PlayarrFilterAction? = null,
    /** Typed header actions (Create, Calendar link, ...); the header orders them and draws them as the one action pill. */
    actions: List<PlayarrPageAction> = emptyList(),
    /**
     * False for pages whose body is a full-bleed hero (library, detail pages): the body fills the screen and
     * draws its own insets and padding, while the shared header (back, title, breadcrumb, actions) floats above.
     */
    padBody: Boolean = true,
    /** Loading, empty or failed: replaces [content] inside the frame, so the header and Back stay up (owner decision Q4). */
    state: PlayarrPageState? = null,
    /** Web phone: the 21.6 px header title used by Search and the detail pages (library headers use 17.6 px). */
    largeTitle: Boolean = false,
    /** Web phone: draw the back button in its focused (inverted, 1.055x) state, as the settings index does. */
    backActive: Boolean = false,
    content: @Composable ColumnScope.() -> Unit,
) {
    val backLabel = playarrString(PlayarrString.CommonBack)
    val actions = buildList {
        addAll(actions)
        if (filters != null) add(PlayarrPageAction.Filters(filters.label, filters.active, filters.badge, filters.onClick))
    }
    Box(modifier) {
        PlayarrPageLayout(
            pageId = pageId,
            header = PlayarrPageHeaderSpec(
                title = title,
                detail = subtitle,
                back = PlayarrBack(backLabel, onBack),
                actions = actions,
                backActive = backActive,
                largeTitle = largeTitle,
            ),
            body = if (padBody) PlayarrPageBody.Panel else PlayarrPageBody.Bleed,
            state = state,
        ) {
            content()
        }
    }
}

/** The state of a page's Filters action. */
internal data class PlayarrFilterAction(
    val label: String,
    val onClick: () -> Unit,
    val active: Boolean = false,
    val badge: Int = 0,
)

/**
 * The ONE right-side pop-out for every panel (filters on all pages, calendar link, playback settings, ...):
 * title with the shared icon close button, scrolling body, optional [footer] actions, modal focus trap, and
 * Back closes it. Panel state belongs to the caller so it can be restored (see CalendarUrlState.panel).
 * PlayarrSidePanelUsageTest keeps ad-hoc bottom sheets and hand-made close buttons out.
 */
@Composable
internal fun PlayarrFiltersSheet(
    title: String,
    kicker: String?,
    closeLabel: String,
    onClose: () -> Unit,
    footer: (@Composable RowScope.() -> Unit)? = null,
    content: @Composable ColumnScope.() -> Unit,
) {
    PlayarrSheetFrame(
        titleContent = { Text(title, color = WebInk, fontSize = 26.sp, fontWeight = FontWeight(590), modifier = Modifier.semantics { heading() }) },
        kicker = kicker,
        closeLabel = closeLabel,
        onClose = onClose,
        dismissible = true,
        footer = footer,
        content = content,
    )
}

/**
 * Drop-in replacement for Material `AlertDialog` that renders in the shared right-hand sheet: [title] in the
 * header beside the shared close button, [text] as the body, [dismissButton] then [confirmButton] as the footer.
 * Every pop-out (confirmations, pickers, playback settings, pairing prompts) goes through this so none drifts
 * from the canonical panel; PlayarrSidePanelUsageTest bans AlertDialog, DatePickerDialog and ModalBottomSheet.
 * [dismissible] = false (the pairing approval) hides the close button and ignores Back and scrim taps.
 */
@Composable
internal fun PlayarrPanel(
    onDismissRequest: () -> Unit,
    title: (@Composable () -> Unit)? = null,
    text: (@Composable () -> Unit)? = null,
    confirmButton: @Composable () -> Unit,
    dismissButton: (@Composable () -> Unit)? = null,
    dismissible: Boolean = true,
) {
    PlayarrSheetFrame(
        titleContent = title?.let { t ->
            { androidx.compose.material3.ProvideTextStyle(androidx.compose.ui.text.TextStyle(fontSize = 26.sp, fontWeight = FontWeight(590), color = WebInk)) { Box(Modifier.semantics { heading() }) { t() } } }
        },
        kicker = null,
        closeLabel = playarrString(PlayarrString.CommonClose),
        onClose = onDismissRequest,
        dismissible = dismissible,
        footer = {
            dismissButton?.invoke()
            confirmButton()
        },
        content = { text?.invoke() },
    )
}

@Composable
private fun PlayarrSheetFrame(
    titleContent: (@Composable () -> Unit)?,
    kicker: String?,
    closeLabel: String,
    onClose: () -> Unit,
    dismissible: Boolean,
    footer: (@Composable RowScope.() -> Unit)?,
    content: @Composable ColumnScope.() -> Unit,
) {
    val focus = remember { FocusRequester() }
    val dismiss = if (dismissible) onClose else ({})
    Dialog(
        onDismissRequest = dismiss,
        properties = DialogProperties(
            dismissOnBackPress = dismissible,
            dismissOnClickOutside = dismissible,
            usePlatformDefaultWidth = false,
            decorFitsSystemWindows = false,
        ),
    ) {
        Box(Modifier.fillMaxSize().background(Color.Black.copy(alpha = 0.45f)).clickable(onClick = dismiss)) {
            BoxWithConstraints(Modifier.align(Alignment.CenterEnd).fillMaxHeight()) {
                Surface(
                    color = WebSurfaceStrong,
                    contentColor = WebInk,
                    modifier = Modifier
                        .fillMaxHeight()
                        .width(minOf(400.dp, maxWidth * 0.92f))
                        .clickable(enabled = false) {},
                ) {
                    Column(
                        Modifier.verticalScroll(rememberScrollState()).padding(horizontal = 24.dp, vertical = 28.dp),
                        verticalArrangement = Arrangement.spacedBy(20.dp),
                    ) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Column(Modifier.weight(1f)) {
                                if (kicker != null) {
                                    Text(kicker.uppercase(), color = WebInkMuted, fontSize = 11.sp, fontWeight = FontWeight.Bold, letterSpacing = 1.sp)
                                }
                                titleContent?.invoke()
                            }
                            if (dismissible) {
                                PlayarrIconButton(onClick = onClose, contentDescription = closeLabel, modifier = Modifier.focusRequester(focus)) {
                                    Icon(Icons.Outlined.Close, contentDescription = null, tint = WebInk)
                                }
                            }
                        }
                        content()
                        if (footer != null) {
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically, content = footer)
                        }
                    }
                }
            }
        }
    }
    LaunchedEffect(Unit) { runCatching { focus.requestFocus() } }
}

@Composable
internal fun PlayarrFilterSection(title: String, content: @Composable () -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Text(title.uppercase(), color = WebInkMuted, fontSize = 11.sp, fontWeight = FontWeight.Bold, letterSpacing = 1.sp, modifier = Modifier.semantics { heading() })
        content()
    }
}

@Composable
internal fun PlayarrChoice(label: String, selected: Boolean, onClick: () -> Unit) {
    val source = remember { MutableInteractionSource() }
    val focused by source.collectIsFocusedAsState()
    val shape = RoundedCornerShape(12.dp)
    Surface(
        onClick = onClick,
        interactionSource = source,
        color = if (selected) WebInk else WebSurfaceSoft.copy(alpha = 0.64f),
        contentColor = if (selected) WebSurface else WebInkSoft,
        shape = shape,
        modifier = Modifier.heightIn(min = 44.dp).webFocusRing(focused, radius = 12.dp, offset = 0.dp),
    ) {
        Box(Modifier.padding(horizontal = 14.dp, vertical = 10.dp), contentAlignment = Alignment.Center) {
            Text(label, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
        }
    }
}

/** Shared multi-select: toggle chips for one filter section. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun <T> PlayarrMultiSelect(
    options: List<Pair<T, String>>,
    selected: Set<T>,
    onChange: (Set<T>) -> Unit,
) {
    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        options.forEach { (value, label) ->
            PlayarrChoice(label, value in selected) { onChange(if (value in selected) selected - value else selected + value) }
        }
    }
}

/** The "View" toggle every page's filters panel carries (single choice). */
@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun <T> PlayarrViewToggle(
    options: List<Pair<T, String>>,
    value: T,
    onChange: (T) -> Unit,
) {
    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        options.forEach { (option, label) -> PlayarrChoice(label, option == value) { onChange(option) } }
    }
}

/** Selected item's details on the LEFT, the browsable list on the RIGHT (stacked on narrow phones). */
@Composable
internal fun PlayarrMasterDetail(
    isTelevision: Boolean,
    detail: @Composable () -> Unit,
    modifier: Modifier = Modifier,
    list: @Composable () -> Unit,
) {
    BoxWithConstraints(modifier) {
        if (isTelevision || maxWidth >= 840.dp) {
            Row(Modifier.fillMaxSize(), horizontalArrangement = Arrangement.spacedBy(40.dp)) {
                Box(Modifier.weight(0.35f).fillMaxHeight().verticalScroll(rememberScrollState())) { detail() }
                Box(Modifier.weight(0.65f).fillMaxHeight()) { list() }
            }
        } else {
            Column(Modifier.fillMaxSize(), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Box(Modifier.fillMaxWidth().heightIn(max = this@BoxWithConstraints.maxHeight * 0.4f).verticalScroll(rememberScrollState())) { detail() }
                Box(Modifier.weight(1f).fillMaxWidth()) { list() }
            }
        }
    }
}

/** Shimmering placeholder; size it like the content that replaces it so nothing shifts. */
@Composable
internal fun PlayarrSkeleton(modifier: Modifier = Modifier, shape: androidx.compose.ui.graphics.Shape = RoundedCornerShape(8.dp)) {
    val transition = rememberInfiniteTransition(label = "skeleton")
    val alpha by transition.animateFloat(
        initialValue = 0.35f,
        targetValue = 0.85f,
        animationSpec = infiniteRepeatable(tween(900), RepeatMode.Reverse),
        label = "skeletonAlpha",
    )
    Box(modifier.alpha(alpha).background(WebSurfaceSoft, shape))
}

/**
 * Web phone top inset: `--mobile-top-inset: max(14px, env(safe-area-inset-top))`. A device with a 24 dp status bar keeps its
 * inset; a window with none (parity captures that mask the system bars) still gets the web's 14 dp.
 */
@androidx.compose.runtime.Composable
internal fun webPhoneInsets(): WindowInsets =
    if (parityNoInsets) WindowInsets(top = 14.dp) else WindowInsets.safeDrawing.union(WindowInsets(top = 14.dp))

/**
 * Parity captures only: a debuggable build started with the `parity_no_insets` extra lays out with no system-bar insets,
 * as the web reference does, and the diff masks the bars. Never set on a release build or on a real device.
 */
internal var parityNoInsets: Boolean = false

/** Parity captures only (same gate as [parityNoInsets]): the player pauses at this position once it is playing. */
internal var parityPauseAtMs: Long? = null

/**
 * Parity captures only (same gate as [parityNoInsets]): the wall clock the screens show, frozen to the shared fixture clock
 * (`FIXTURE_CLOCK`, 2026-10-07T12:00:00Z) so the agenda, the chrome clock and "today" do not depend on the real date.
 */
internal var parityClock: java.time.Instant? = null

internal fun playarrNow(zone: java.time.ZoneId = java.time.ZoneId.systemDefault()): java.time.LocalDateTime =
    parityClock?.let { java.time.LocalDateTime.ofInstant(it, zone) } ?: java.time.LocalDateTime.now(zone)

internal fun playarrToday(zone: java.time.ZoneId = java.time.ZoneId.systemDefault()): java.time.LocalDate = playarrNow(zone).toLocalDate()

/** The web page body does not follow the top inset: it starts where a 24 dp status bar leaves it. */
@androidx.compose.runtime.Composable
internal fun webPhoneBodyInsets(): WindowInsets =
    if (parityNoInsets) WindowInsets(top = 24.dp) else WindowInsets.safeDrawing.union(WindowInsets(top = 24.dp))

/** The error state for a failed load: the message in the danger colour and the shared "Try again" action. */
@Composable
internal fun PlayarrErrorState(message: PlayarrMessage, onRetry: () -> Unit) {
    PlayarrErrorState(PlayarrErrorSpec(playarrText(message), playarrString(PlayarrString.CommonTryAgain)), onRetry)
}

/** The page state for a failed load, for [PlayarrPageScaffold]'s `state`. */
@Composable
internal fun playarrErrorState(message: PlayarrMessage, onRetry: () -> Unit): PlayarrPageState =
    PlayarrPageState.Error(PlayarrErrorSpec(playarrText(message), playarrString(PlayarrString.CommonTryAgain)), onRetry)
