package io.playarr.mobile.ui

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
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
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
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties

/*
 * Shared page frame for every routed Android screen (web `PageShell`/`PageHeader` parity):
 * back button top-left, large title, hairline divider + breadcrumb, right-side actions (Filters,
 * then secondary panel buttons stacked below it), and a body that stays clear of the profile chip
 * pinned bottom-left. PlayarrPageScaffoldRegistryTest keeps new screens from bypassing it.
 */

/** Web header icon button fill and ring (`a.ui-btn--icon`, dark theme). */
private val WebHeaderIconFill = Color(0xB3211D21)
private val WebHeaderIconRing = Color(0x27DFDCDD)

/** Space the body reserves at the bottom so nothing renders under the bottom-left profile chip. */
internal fun playarrPageSafeBottom(isTelevision: Boolean): Dp = if (isTelevision) 96.dp else 72.dp

/** Left edge of page content: clears the 118 dp navigation rail on television. */
internal fun playarrPageStart(isTelevision: Boolean): Dp = if (isTelevision) 154.dp else 16.dp

internal fun playarrPageEnd(isTelevision: Boolean): Dp = if (isTelevision) 72.dp else 16.dp

@Composable
internal fun PlayarrPageScaffold(
    title: String,
    onBack: () -> Unit,
    isTelevision: Boolean,
    modifier: Modifier = Modifier,
    subtitle: String? = null,
    /** The page's Filters action; rendered by the one shared [PlayarrHeaderActions] so every page matches. */
    filters: PlayarrFilterAction? = null,
    /** Panel buttons (Create, Calendar link, ...) in a row immediately left of Filters. */
    panelActions: (@Composable RowScope.() -> Unit)? = null,
    /** Period navigation (previous / today / next) in the same right cluster, left of the panel buttons. */
    trailingNav: (@Composable RowScope.() -> Unit)? = null,
    /**
     * False for pages whose body is a full-bleed hero (library, detail pages): the body fills the screen and
     * draws its own insets and padding, while the shared header (back, title, breadcrumb, actions) floats above.
     */
    padBody: Boolean = true,
    content: @Composable ColumnScope.() -> Unit,
) {
    val headerInsets = if (padBody || isTelevision) Modifier else Modifier.windowInsetsPadding(WindowInsets.safeDrawing)
    Box(
        modifier
            .fillMaxSize()
            .background(WebSurface)
            .then(if (isTelevision || !padBody) Modifier else Modifier.windowInsetsPadding(WindowInsets.safeDrawing)),
    ) {
        Column(
            if (padBody) {
                Modifier
                    .fillMaxSize()
                    .padding(
                        start = playarrPageStart(isTelevision),
                        end = playarrPageEnd(isTelevision),
                        top = (if (isTelevision) 56.dp + 50.dp + 16.dp else 16.dp + 44.dp + 12.dp) + (if (subtitle != null) (if (isTelevision) 22.dp else 18.dp) else 0.dp),
                        bottom = playarrPageSafeBottom(isTelevision),
                    )
            } else {
                Modifier.fillMaxSize()
            },
            content = content,
        )
        PlayarrPageHeaderRow(
            title = title,
            subtitle = subtitle,
            onBack = onBack,
            isTelevision = isTelevision,
            modifier = Modifier
                .align(Alignment.TopStart)
                .then(headerInsets)
                .padding(start = if (isTelevision) 154.dp else 8.dp, top = if (isTelevision) 56.dp else 16.dp),
        )
        if (filters != null || panelActions != null || trailingNav != null) {
            PlayarrHeaderActions(
                isTelevision = isTelevision,
                filters = filters,
                panelActions = panelActions,
                trailingNav = trailingNav,
                modifier = Modifier.align(Alignment.TopEnd).then(headerInsets),
            )
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
 * The one right-hand header cluster, one row: [trailingNav] (previous / today / next), then [panelActions]
 * (Create, Calendar link, ...), then Filters last, so Filters sits in the identical spot on every page.
 * Pages never place their own Filters launcher; PlayarrPageScaffoldRegistryTest compares Calendar with Library.
 */
@Composable
internal fun PlayarrHeaderActions(
    isTelevision: Boolean,
    filters: PlayarrFilterAction?,
    modifier: Modifier = Modifier,
    panelActions: (@Composable RowScope.() -> Unit)? = null,
    trailingNav: (@Composable RowScope.() -> Unit)? = null,
) {
    Row(
        // On phones the profile chip is pinned top-right, so the cluster stops short of it.
        modifier.padding(end = if (isTelevision) playarrPageEnd(true) else 72.dp, top = if (isTelevision) 56.dp else 16.dp),
        horizontalArrangement = Arrangement.spacedBy(10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (trailingNav != null) Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically, content = trailingNav)
        if (panelActions != null) Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically, content = panelActions)
        if (filters != null) {
            PlayarrHeaderButton(
                label = filters.label,
                icon = Icons.Outlined.Tune,
                isTelevision = isTelevision,
                active = filters.active,
                badge = filters.badge,
                onClick = filters.onClick,
            )
        }
    }
}

/** Where a header breadcrumb goes relative to the title. */
internal enum class PlayarrSubtitlePlacement { None, Inline, Wrapped }

/**
 * Pure placement rule: the breadcrumb stays on the title line only when it fits between the end of the
 * title block and the start of the clock's reserved area; otherwise it wraps beneath the title.
 */
internal fun decideSubtitlePlacement(
    hasSubtitle: Boolean,
    titleEndPx: Int,
    subtitleWidthPx: Int,
    separatorPx: Int,
    reservedStartPx: Int?,
): PlayarrSubtitlePlacement = when {
    !hasSubtitle -> PlayarrSubtitlePlacement.None
    reservedStartPx == null -> PlayarrSubtitlePlacement.Inline
    titleEndPx + separatorPx + subtitleWidthPx <= reservedStartPx -> PlayarrSubtitlePlacement.Inline
    else -> PlayarrSubtitlePlacement.Wrapped
}

/** Start of the shell clock's reserved area on television (the clock is drawn at 558.1 dp, top 68.2 dp, as web). */
internal val PlayarrClockReservedStart = 550.dp

/**
 * Back + title + breadcrumb row. The title is truncated before the clock; the breadcrumb sits on the
 * title line behind a vertical divider when it fits before the clock, else wraps under the title behind a
 * horizontal rule, so it never renders beneath the clock/date.
 */
@Composable
internal fun PlayarrPageHeaderRow(
    title: String,
    subtitle: String?,
    onBack: () -> Unit,
    isTelevision: Boolean,
    modifier: Modifier = Modifier,
    /** Absolute x (from the screen's left edge) where this row starts; used to measure against the clock. */
    startInset: Dp = if (isTelevision) 154.dp else 8.dp,
) {
    val density = androidx.compose.ui.platform.LocalDensity.current
    val reservedStartPx = if (isTelevision) with(density) { (PlayarrClockReservedStart - startInset).roundToPx() } else null
    androidx.compose.ui.layout.SubcomposeLayout(modifier) { constraints ->
        val loose = androidx.compose.ui.unit.Constraints()
        val backSize = (if (isTelevision) 50.dp else 44.dp).roundToPx()
        val gap = (if (isTelevision) 23.dp else 12.dp).roundToPx()
        val back = subcompose("back") {
            PlayarrIconButton(
                onClick = onBack,
                contentDescription = playarrString(PlayarrString.CommonBack),
                size = if (isTelevision) PlayarrButtonSize.Large else PlayarrButtonSize.Medium,
                variant = if (isTelevision) PlayarrButtonVariant.Ghost else PlayarrButtonVariant.Secondary,
                modifier = if (isTelevision) {
                    // Web `a.ui-btn--icon`: rgba(33,29,33,.7) fill with a 1px rgba(223,220,221,.15) ring and a text arrow.
                    Modifier
                        .background(WebHeaderIconFill, CircleShape)
                        .border(1.dp, WebHeaderIconRing, CircleShape)
                } else {
                    Modifier
                },
            ) {
                if (isTelevision) {
                    Text("\u2190", color = WebInkSoft, fontSize = 17.28.sp, fontWeight = FontWeight(720))
                } else {
                    Icon(Icons.AutoMirrored.Outlined.ArrowBack, contentDescription = null, tint = WebInk, modifier = Modifier.size(20.dp))
                }
            }
        }.first().measure(androidx.compose.ui.unit.Constraints.fixed(backSize, backSize))
        val titleMax = ((reservedStartPx ?: constraints.maxWidth) - back.width - gap).coerceAtLeast(0)
        val titleP = subcompose("title") {
            Text(
                title,
                color = WebInk,
                fontSize = if (isTelevision) 34.sp else 24.sp,
                fontWeight = FontWeight(580),
                letterSpacing = (-1.5).sp,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.semantics { heading() },
            )
        }.first().measure(loose.copy(maxWidth = titleMax.coerceAtMost(constraints.maxWidth)))
        val separator = (if (isTelevision) 47.04.dp else 24.dp).roundToPx()
        val titleEnd = back.width + gap + titleP.width
        val probe = subtitle?.let {
            subcompose("probe") { PlayarrBreadcrumbText(it) }.first().measure(loose)
        }
        val placement = decideSubtitlePlacement(subtitle != null, titleEnd, probe?.width ?: 0, separator, reservedStartPx)
        val inline = if (placement == PlayarrSubtitlePlacement.Inline) {
            subcompose("inline") {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Box(Modifier.padding(horizontal = if (isTelevision) 23.04.dp else 10.dp).width(1.dp).height(if (isTelevision) 50.dp else 16.dp).background(if (isTelevision) Color(0x3BDFDCDD) else WebInkMuted.copy(alpha = 0.45f)))
                    PlayarrBreadcrumbText(subtitle!!)
                }
            }.first().measure(loose)
        } else {
            null
        }
        val wrapped = if (placement == PlayarrSubtitlePlacement.Wrapped) {
            subcompose("wrapped") {
                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Box(Modifier.fillMaxWidth().height(1.dp).background(WebInkMuted.copy(alpha = 0.45f)))
                    PlayarrBreadcrumbText(subtitle!!)
                }
            }.first().measure(loose.copy(maxWidth = (constraints.maxWidth - back.width - gap).coerceAtLeast(0).coerceAtMost((titleP.width + 160.dp.roundToPx()).coerceAtLeast(titleP.width))))
        } else {
            null
        }
        val rowHeight = maxOf(back.height, titleP.height)
        val width = maxOf(titleEnd + (inline?.width ?: 0), back.width + gap + (wrapped?.width ?: 0))
        val height = rowHeight + (wrapped?.let { it.height + 6.dp.roundToPx() } ?: 0)
        layout(width.coerceAtMost(constraints.maxWidth.coerceAtLeast(width)), height) {
            back.placeRelative(0, (rowHeight - back.height) / 2)
            titleP.placeRelative(back.width + gap, (rowHeight - titleP.height) / 2)
            inline?.placeRelative(titleEnd, (rowHeight - inline.height) / 2)
            wrapped?.placeRelative(back.width + gap, rowHeight + 6.dp.roundToPx())
        }
    }
}

@Composable
private fun PlayarrBreadcrumbText(text: String) {
    Text(
        text,
        color = WebInkMuted,
        fontSize = 11.136.sp,
        fontWeight = FontWeight(680),
        letterSpacing = 0.501.sp,
        maxLines = 1,
        overflow = TextOverflow.Ellipsis,
    )
}

/** Header action in the shared rounded style (Filters, Calendar subscription, ...). */
@Composable
internal fun PlayarrHeaderButton(
    label: String,
    icon: ImageVector,
    isTelevision: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    active: Boolean = false,
    badge: Int = 0,
) {
    PlayarrButton(
        onClick = onClick,
        modifier = modifier,
        variant = PlayarrButtonVariant.Secondary,
        size = if (isTelevision) PlayarrButtonSize.Medium else PlayarrButtonSize.Small,
        active = active,
    ) {
        Icon(icon, contentDescription = null, modifier = Modifier.size(18.dp))
        Text(label, fontSize = if (isTelevision) 14.sp else 13.sp, fontWeight = FontWeight.SemiBold, maxLines = 1)
        if (badge > 0) {
            Surface(color = WebPink, shape = CircleShape) {
                Text(
                    badge.toString(),
                    color = Color.White,
                    fontSize = 11.sp,
                    fontWeight = FontWeight.Bold,
                    modifier = Modifier.padding(horizontal = 7.dp, vertical = 1.dp),
                )
            }
        }
    }
}

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
        modifier = Modifier.heightIn(min = 44.dp).then(if (focused) Modifier.border(BorderStroke(3.dp, WebPink), shape) else Modifier),
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
