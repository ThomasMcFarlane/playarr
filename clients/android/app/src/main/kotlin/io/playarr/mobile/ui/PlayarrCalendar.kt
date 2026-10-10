package io.playarr.mobile.ui

import io.playarr.shared.designsystem.page.PlayarrPageBody
import io.playarr.shared.designsystem.page.PlayarrPageLayout
import io.playarr.shared.designsystem.page.playarrPageMetrics
import io.playarr.shared.designsystem.page.PlayarrPageId
import io.playarr.shared.designsystem.page.PlayarrNavItem
import io.playarr.shared.designsystem.page.PlayarrErrorState
import io.playarr.shared.designsystem.page.PlayarrEmptyState
import io.playarr.shared.designsystem.page.PlayarrActionIcon
import io.playarr.shared.designsystem.page.PlayarrPageAction
import io.playarr.shared.designsystem.icons.PlayarrWebIcons
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.layout.offset
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.graphics.drawscope.clipPath
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.text.withStyle
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsFocusedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.material.icons.outlined.Link
import androidx.compose.material3.DatePicker
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.ScrollState
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.KeyboardArrowLeft
import androidx.compose.material.icons.automirrored.outlined.KeyboardArrowRight
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material.icons.outlined.ArrowDropDown
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.runtime.saveable.rememberSaveable
import io.playarr.shared.designsystem.component.PlayarrButton
import io.playarr.shared.designsystem.component.PlayarrButtonSize
import io.playarr.shared.designsystem.component.PlayarrButtonVariant
import io.playarr.shared.designsystem.component.PlayarrIconButton
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import coil3.compose.AsyncImage
import io.playarr.shared.data.model.CalendarEntry
import io.playarr.shared.data.model.CalendarMediaKind
import io.playarr.shared.data.model.CalendarSourceStatus
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Locale

// ---- Calendar screen -------------------------------------------------------

private val CALENDAR_LIVE_INTEREST = setOf(io.playarr.shared.data.events.LiveTarget(io.playarr.shared.data.events.LiveArea.Calendar))

/** No state layer: on TV the web focus state is the ring alone, never a background fill. */
private object CalendarNoFocusFill : androidx.compose.foundation.IndicationNodeFactory {
    override fun create(interactionSource: androidx.compose.foundation.interaction.InteractionSource): androidx.compose.ui.node.DelegatableNode =
        object : androidx.compose.ui.Modifier.Node() {}
    override fun equals(other: Any?): Boolean = other === CalendarNoFocusFill
    override fun hashCode(): Int = System.identityHashCode(this)
}

@Composable
internal fun ExperienceCalendarRoute(
    isTelevision: Boolean,
    onBack: () -> Unit,
    onOpenWork: (String) -> Unit,
    onPlay: (String) -> Unit = {},
    viewModel: CalendarViewModel = hiltViewModel(),
) {
    if (isTelevision) {
        androidx.compose.runtime.CompositionLocalProvider(
            androidx.compose.foundation.LocalIndication provides CalendarNoFocusFill,
        ) { ExperienceCalendarScreen(isTelevision, onBack, onOpenWork, onPlay, viewModel) }
    } else {
        ExperienceCalendarScreen(isTelevision, onBack, onOpenWork, onPlay, viewModel)
    }
}

@Composable
private fun ExperienceCalendarScreen(
    isTelevision: Boolean,
    onBack: () -> Unit,
    onOpenWork: (String) -> Unit,
    onPlay: (String) -> Unit,
    viewModel: CalendarViewModel,
) {
    val state by viewModel.calendar.state.collectAsState()
    LiveRefreshEffect(
        viewModel.liveBus,
        CALENDAR_LIVE_INTEREST,
        { viewModel.calendar.fetchStartedMs },
        viewModel.calendar::refresh,
    )
    val language = LocalPlayarrLanguage.current
    val holder = viewModel.calendar
    val today = remember { playarrToday() }
    val zone = remember { ZoneId.systemDefault() }
    val ready = (state.load as? CalendarLoad.Ready)?.response
    val loading = state.load == CalendarLoad.Loading
    val filtered = remember(ready, state.filters) {
        ready?.entries?.let { applyCalendarFilters(it, state.filters, today, zone) }.orEmpty()
    }
    val groups = remember(filtered, state.window, state.mode) {
        groupCalendarEntries(filtered, emptySet(), state.window, fillEmptyDays = state.mode == CalendarViewMode.Week)
    }
    val items = remember(groups) { groups.flatMap { groupSeriesEpisodes(it.entries, zone) } }
    val selectedItem = items.firstOrNull { it.key == state.selectedKey }
    // Agenda is master-detail: with nothing selected yet, the first release is previewed.
    val detailItem = if (state.mode == CalendarViewMode.Agenda) selectedItem ?: items.firstOrNull() else selectedItem
    val filtersLabel = playarrString(PlayarrString.LibraryFilters)
    var jumpOpen by rememberSaveable { mutableStateOf(false) }
    // Web: the subscription bell is the same launcher as Filters, beside it (icon only on phones).
    val bellAction = PlayarrPageAction.Panel(
        id = "calendar-link",
        label = playarrString(PlayarrString.CalendarLinkTitle),
        icon = PlayarrActionIcon.Bell,
        open = state.panel == CalendarPanel.Subscription,
        onToggle = { holder.openPanel(CalendarPanel.Subscription) },
    )
    // Period navigation is a typed Navigation action: the page header orders it first and draws round arrows and Today.
    val navigation = PlayarrPageAction.Navigation(
        id = "calendar-period",
        items = listOf(
            PlayarrNavItem("previous", playarrString(PlayarrString.CalendarPrevious), PlayarrActionIcon.Prev, onClick = holder::previous),
            // Web TV: Today holds the autofocus ring on entry.
            PlayarrNavItem("today", playarrString(PlayarrString.CalendarToday), null, primary = true, modifier = Modifier.tvContentDefaultFocus(), onClick = holder::goToToday),
            PlayarrNavItem("next", playarrString(PlayarrString.CalendarNext), PlayarrActionIcon.Next, onClick = holder::next),
        ),
    )
    PlayarrPageLayout(
        pageId = PlayarrPageId.Calendar,
        header = playarrPageHeader(title = playarrString(PlayarrString.CalendarTitle), onBack = onBack, filters = PlayarrFilterAction(
            label = filtersLabel,
            active = state.panel == CalendarPanel.Filters,
            badge = state.filters.activeCount,
            onClick = { holder.openPanel(CalendarPanel.Filters) },
        ), actions = if (isTelevision) listOf(navigation, bellAction) else listOf(bellAction)),
        body = if (!(isTelevision && state.mode == CalendarViewMode.Agenda)) PlayarrPageBody.Panel else PlayarrPageBody.Bleed,
    ) {
        if (!isTelevision) {
            PhoneCalendarHeader(state, language.locale, holder) { jumpOpen = true }
        } else if (state.mode != CalendarViewMode.Agenda) {
            // shortcut: web puts the range button in the header's Previous / Today / Next group; the shared navigation
            // pill has a fixed width (page package, owner-request gate), so the range stays in the page until it can grow.
            CalendarPeriodLabel(state, isTelevision, language.locale) { jumpOpen = true }
        }
        when (val load = state.load) {
            is CalendarLoad.Failed -> Box(Modifier.weight(1f).fillMaxWidth()) { PlayarrErrorState(load.message, holder::load) }
            else -> {
                if (ready != null) {
                    val failed = failedCalendarSources(ready.sources)
                    if (failed.isNotEmpty()) CalendarSourceBanner(failed, onRetry = holder::load)
                }
                val empty = !loading && items.isEmpty()
                if (empty) {
                    Box(Modifier.weight(1f).fillMaxWidth()) {
                        PlayarrEmptyState(
                            playarrString(PlayarrString.CalendarEmptyTitle),
                            playarrString(PlayarrString.CalendarEmptyDescription),
                        )
                    }
                } else {
                    // The whole view structure renders immediately; skeletons fill it while loading, so content never shifts.
                    val body = Modifier.weight(1f).fillMaxWidth()
                    when (state.mode) {
                        CalendarViewMode.Agenda -> if (!isTelevision) PhoneCalendarAgenda(
                            groups = groups, loading = loading, selected = detailItem, today = today, zone = zone, locale = language.locale,
                            onSelect = { holder.select(it.key) }, onOpenWork = onOpenWork, onPlay = onPlay, actions = viewModel.actions, modifier = body,
                        ) else TvCalendarAgenda(
                            state = state, groups = groups, loading = loading, selected = detailItem, zone = zone, locale = language.locale, today = today,
                            onSelect = { holder.select(it.key) }, onOpenWork = onOpenWork, onPlay = onPlay, actions = viewModel.actions,
                            onJump = { jumpOpen = true },
                        )
                        CalendarViewMode.Week -> CalendarWeek(
                            groups = groups, loading = loading, isTelevision = isTelevision, today = today, zone = zone,
                            locale = language.locale, selectedKey = selectedItem?.key,
                            onSelect = { holder.select(it.key) }, modifier = body,
                        )
                        CalendarViewMode.Month -> CalendarMonth(
                            state = state, entries = filtered, loading = loading, isTelevision = isTelevision, today = today,
                            zone = zone, locale = language.locale, onSelectDay = holder::selectDay,
                            onSelect = { holder.select(it.key) }, modifier = body,
                            onMore = { holder.showDay(CalendarViewMode.Agenda, it) },
                        )
                    }
                }
            }
        }
    }
    if (jumpOpen) {
        CalendarJumpDialog(
            anchor = state.anchor,
            locale = language.locale,
            onDismiss = { jumpOpen = false },
            onJump = { day -> jumpOpen = false; holder.showDay(state.mode, day) },
        )
    }
    if (state.mode != CalendarViewMode.Agenda && selectedItem != null) {
        CalendarItemDialog(
            item = selectedItem, isTelevision = isTelevision, locale = language.locale, zone = zone,
            onDismiss = { holder.select(null) },
            onOpenWork = { holder.select(null); onOpenWork(it) },
            actions = viewModel.actions,
        )
    }
    when (state.panel) {
        CalendarPanel.Filters -> CalendarFiltersSheet(state, ready?.sources.orEmpty(), isTelevision, holder)
        CalendarPanel.Subscription -> CalendarSubscriptionSheet(
            holder = viewModel.subscription,
            isTelevision = isTelevision,
            locale = language.locale,
            onDismiss = {
                viewModel.subscription.dismissCreated()
                holder.openPanel(null)
            },
        )
        null -> Unit
    }
}

/** Type and spacing of the agenda details and rows: the phone values, or the web TV values. */
internal data class CalendarMetrics(
    val eyebrow: Float, val eyebrowLine: Float, val eyebrowSpacing: Float, val afterEyebrow: Float,
    val title: Float, val titleLine: Float, val afterTitle: Float,
    val body: Float, val bodyLine: Float, val afterSub: Float,
    val label: Float, val labelLine: Float, val labelSpacing: Float, val factGap: Float,
    val badge: Float, val badgeHeight: Float, val badgePad: Float,
    val beforeActions: Float, val pillHeight: Float, val pill: Float, val pillLine: Float, val pillPad: Float, val pillGap: Float,
    val entryHeight: Float, val entryTitle: Float, val entryTitleLine: Float, val entryMeta: Float, val entryMetaLine: Float,
    val poster: Pair<Float, Float>, val entryRadius: Float, val dayHeading: Float, val dayHeadingLine: Float,
)

internal val PhoneCalendarMetrics = CalendarMetrics(
    9.28f, 13.92f, 1.6704f, 14.4f, 22.4f, 33.6f, 14.4f, 16f, 24f, 14.4f, 11.52f, 17.28f, 1.152f, 9.6f,
    16f, 19f, 8f, 15.1f, 44f, 11.52f, 17.28f, 20.6f, 9.6f, 90f, 16f, 24f, 12.8f, 19.2f, 40f to 60f, 12f, 14.4f, 21.6f,
)

/** Web TV `.calendar` agenda at 1920 x 1080, read off the committed references. */
internal val TvCalendarMetrics = CalendarMetrics(
    11.7f, 18f, 2.1f, 17f, 38.7f, 46f, 14f, 19.4f, 28f, 15f, 11.6f, 17f, 1.16f, 10.5f,
    19.4f, 23f, 8f, 15f, 58f, 15f, 22f, 19f, 10f, 108f, 20f, 28f, 13f, 19f, 40f to 60f, 14f, 18.7f, 28f,
)

internal val LocalCalendarMetrics = androidx.compose.runtime.compositionLocalOf { PhoneCalendarMetrics }

/** The web phone calendar header: period picker (two centred lines) beside the previous / Today / next cluster. */
@Composable
private fun PhoneCalendarHeader(state: CalendarUiState, locale: Locale, holder: CalendarStateHolder, onJump: () -> Unit) {
    val title = remember(state.window, state.mode, state.anchor, locale) { phoneCalendarRangeTitle(state.mode, state.anchor, state.window, locale) }
    Row(Modifier.fillMaxWidth().height(90.dp).padding(bottom = 0.dp), horizontalArrangement = Arrangement.spacedBy(9.6.dp)) {
        Box(Modifier.padding(top = 8.dp).width(188.9.dp).height(74.dp).clip(CircleShape).clickable(onClick = onJump).padding(horizontal = 21.dp), contentAlignment = Alignment.CenterStart) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(9.6.dp)) {
                Text(
                    title, color = WebInk, fontSize = 16.sp, lineHeight = 24.sp, fontWeight = FontWeight(640), textAlign = TextAlign.Center,
                    style = WebTextStyle, modifier = Modifier.width(131.5.dp).semantics { liveRegion = LiveRegionMode.Polite },
                )
                // The web draws a "▼" glyph from a fallback font: a solid 6 x 5.4 triangle.
                val ink = WebInk
                androidx.compose.foundation.Canvas(Modifier.padding(start = 0.5.dp).size(width = 7.6.dp, height = 6.8.dp)) {
                    val path = androidx.compose.ui.graphics.Path().apply {
                        moveTo(0f, 0f); lineTo(size.width, 0f); lineTo(size.width / 2f, size.height); close()
                    }
                    drawPath(path, ink)
                }
            }
        }
        Box(Modifier.width(159.5.dp).height(90.dp)) {
            PhoneCalendarRound(Modifier.offset(y = 3.dp), "←", playarrString(PlayarrString.CalendarPrevious), holder::previous)
            PhoneCalendarRound(Modifier.offset(y = 52.dp), "→", playarrString(PlayarrString.CalendarNext), holder::next)
            // Web: Today holds the autofocus ring, drawn 1.055x.
            val ring = WebInk
            Surface(
                onClick = holder::goToToday,
                modifier = Modifier.offset(x = 46.dp, y = 0.dp).size(73.1.dp, 44.dp)
                    .graphicsLayer { scaleX = 1.055f; scaleY = 1.055f }
                    .drawBehind {
                        val grow = 3.5.dp.toPx()
                        drawRoundRect(
                            color = ring,
                            topLeft = androidx.compose.ui.geometry.Offset(-grow, -grow),
                            size = androidx.compose.ui.geometry.Size(size.width + 2 * grow, size.height + 2 * grow),
                            cornerRadius = androidx.compose.ui.geometry.CornerRadius((size.height + 2 * grow) / 2f),
                            style = androidx.compose.ui.graphics.drawscope.Stroke(width = 3.dp.toPx()),
                        )
                    },
                shape = CircleShape, color = WebSurface, contentColor = WebInkSoft,
                border = BorderStroke(1.dp, WebPillBorder),
            ) {
                Box(contentAlignment = Alignment.Center) {
                    Text(playarrString(PlayarrString.CalendarToday), fontSize = 11.52.sp, lineHeight = 17.28.sp, fontWeight = FontWeight(720), style = WebTextStyle)
                }
            }
        }
    }
}

@Composable
private fun PhoneCalendarRound(modifier: Modifier, glyph: String, description: String, onClick: () -> Unit) {
    Surface(
        onClick = onClick,
        modifier = modifier.size(38.dp).semantics { contentDescription = description },
        shape = CircleShape, color = WebSurface, contentColor = WebInkSoft,
        border = BorderStroke(1.dp, WebPillBorder),
    ) {
        Box(contentAlignment = Alignment.Center) {
            Text(glyph, fontSize = 11.52.sp, lineHeight = 17.28.sp, fontWeight = FontWeight(720), style = WebTextStyle)
        }
    }
}

/** Range title as the web formats it (`Intl` date-range style): "7 Oct – 5 Nov 2026" in en-GB, "Oct 7 – Nov 5, 2026" in en-US. */
private fun phoneCalendarRangeTitle(mode: CalendarViewMode, anchor: LocalDate, window: CalendarWindow, locale: Locale): String {
    if (mode == CalendarViewMode.Month) return calendarWindowTitle(mode, anchor, window, locale)
    return playarrRangeLabel(window.start, if (mode == CalendarViewMode.Agenda) window.end.minusDays(1) else window.end, locale)
}

/** Web phone agenda: the selected release's details first, then the day list. */
@Composable
private fun PhoneCalendarAgenda(
    groups: List<CalendarDayGroup>,
    loading: Boolean,
    selected: CalendarItem?,
    today: LocalDate,
    zone: ZoneId,
    locale: Locale,
    onSelect: (CalendarItem) -> Unit,
    onOpenWork: (String) -> Unit,
    onPlay: (String) -> Unit,
    actions: CalendarActionsHolder,
    modifier: Modifier,
) {
    LazyColumn(modifier, contentPadding = PaddingValues(top = 12.dp, bottom = 96.dp)) {
        item {
            when {
                loading -> CalendarDetailSkeleton()
                selected != null -> PhoneCalendarDetails(selected, locale, zone, onOpenWork, onPlay, actions)
                else -> Text(playarrString(PlayarrString.CalendarSelectPrompt), color = WebInkMuted)
            }
        }
        item { Spacer(Modifier.height(24.6.dp)) }
        if (loading) {
            items(3) { Column(Modifier.padding(horizontal = 4.dp, vertical = 4.dp)) { PlayarrSkeleton(Modifier.width(180.dp).height(18.dp)); Spacer(Modifier.height(8.dp)); CalendarRowSkeleton() } }
        } else {
            groups.forEach { group ->
                item(key = "day-${group.date}") {
                    Text(
                        phoneCalendarDayHeading(group.date, locale), color = WebInk, fontSize = 14.4.sp, lineHeight = 21.6.sp, fontWeight = FontWeight(640),
                        style = WebTextStyle, modifier = Modifier.padding(start = 4.dp, top = 4.dp, bottom = 6.4.dp).semantics { heading() },
                    )
                }
                items(groupSeriesEpisodes(group.entries, zone), key = { "${group.date}-${it.key}" }) { item ->
                    PhoneCalendarEntry(item, selected = item.key == selected?.key, zone = zone, onClick = { onSelect(item) })
                    Spacer(Modifier.height(8.dp))
                }
            }
        }
    }
}

private fun phoneCalendarDayHeading(day: LocalDate, locale: Locale): String =
    PlayarrDateFormat("MMMMEEEEd", locale).format(day)

@Composable
private fun PhoneCalendarDetails(item: CalendarItem, locale: Locale, zone: ZoneId, onOpenWork: (String) -> Unit, onPlay: (String) -> Unit, actions: CalendarActionsHolder) {
    val entry = item.first
    val kind = CalendarMediaKind.fromWire(entry.mediaKind)
    val kindLabel = if (kind == CalendarMediaKind.Episode) playarrString(PlayarrString.CalendarDetailKindEpisode) else kind?.let { calendarKindLabel(it) } ?: entry.mediaKind
    val allDay = playarrString(PlayarrString.CalendarAllDay)
    val whenText = remember(entry.releaseAt, locale, zone, allDay) {
        entry.releaseAt?.let { playarrFullDateTime(it, zone, locale) }
        ?: "${formatCalendarDay(entry.date, locale)} · $allDay"
    }
    val state = when (item) {
        is CalendarItem.Series -> item.entries.let { all ->
            when {
                all.all { it.hasFile } -> CalendarLibraryState.InLibrary
                all.any { it.monitored } -> CalendarLibraryState.Monitored
                else -> CalendarLibraryState.NotMonitored
            }
        }
        is CalendarItem.Single -> entry.libraryState()
    }
    val workId = entry.openWorkId
    val m = LocalCalendarMetrics.current
    Column(Modifier.padding(top = 4.dp)) {
        Text(
            "$kindLabel · ${calendarReleaseTypeLabel(entry.releaseType)}".uppercase(locale), color = WebInkMuted, fontSize = m.eyebrow.sp, lineHeight = m.eyebrowLine.sp,
            fontWeight = FontWeight(760), letterSpacing = m.eyebrowSpacing.sp, style = WebTextStyle,
        )
        Spacer(Modifier.height(m.afterEyebrow.dp))
        Text(
            item.title, color = WebInk, fontSize = m.title.sp, lineHeight = m.titleLine.sp, fontWeight = FontWeight(590), letterSpacing = (-0.04f * m.title).sp,
            style = WebTextStyle, modifier = Modifier.semantics { heading() },
        )
        Spacer(Modifier.height(m.afterTitle.dp))
        Text(calendarItemSubtitle(item), color = WebInk, fontSize = m.body.sp, lineHeight = m.bodyLine.sp, style = WebTextStyle)
        Spacer(Modifier.height(m.afterSub.dp))
        PhoneCalendarFact(playarrString(PlayarrString.CalendarSheetWhen)) {
            Text(whenText, color = WebInk, fontSize = m.body.sp, lineHeight = m.bodyLine.sp, style = WebTextStyle)
        }
        Spacer(Modifier.height(m.factGap.dp))
        PhoneCalendarFact(playarrString(PlayarrString.CalendarSheetState)) {
            PhoneCalendarBadge(calendarStateLabel(state), m.body.sp, m.bodyLine.sp)
        }
        // No "Reported by" line: users never see source-provider names (owner rule 2026-10-09).
        Spacer(Modifier.height(m.beforeActions.dp))
        CalendarDetailActions(item, onOpenWork, onPlay, actions)
    }
}

@Composable
private fun PhoneCalendarFact(label: String, value: @Composable () -> Unit) {
    Column {
        val m = LocalCalendarMetrics.current
        Text(label.uppercase(), color = WebInkMuted, fontSize = m.label.sp, lineHeight = m.labelLine.sp, letterSpacing = m.labelSpacing.sp, style = WebTextStyle)
        value()
    }
}

@Composable
private fun PhoneCalendarBadge(label: String, size: androidx.compose.ui.unit.TextUnit, line: androidx.compose.ui.unit.TextUnit) {
    val m = LocalCalendarMetrics.current
    Box(
        Modifier.then(if (m === TvCalendarMetrics) Modifier.offset(y = (-3).dp) else Modifier).padding(vertical = if (size.value > 14f) 2.dp else 0.dp).height(if (m === TvCalendarMetrics) m.badgeHeight.dp else if (size.value > 14f) 19.dp else 19.2.dp)
            .background(Color(0xFF5B7FD1).copy(alpha = 0.24f), CircleShape).padding(horizontal = m.badgePad.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(label, color = WebInk, fontSize = size, lineHeight = 19.sp, fontWeight = FontWeight(640), style = WebTextStyle, maxLines = 1, modifier = Modifier.offset(y = (-1.33).dp))
    }
}

@Composable
private fun PhoneCalendarPill(label: String, glyph: String? = null, enabled: Boolean = true, primary: Boolean = false, onClick: () -> Unit) {
    val m = LocalCalendarMetrics.current
    Surface(
        onClick = onClick, enabled = enabled, shape = CircleShape,
        color = if (primary) (if (webIsDark) Color(0xFFDFDCDD) else Color(0xFF675961)) else WebSurface,
        contentColor = if (primary) (if (webIsDark) Color(0xFF151315) else Color.White) else WebInkSoft,
        border = if (primary) null else BorderStroke(1.dp, WebPillBorder), modifier = Modifier.height(m.pillHeight.dp),
    ) {
        Row(Modifier.padding(horizontal = m.pillPad.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            if (glyph != null) Text(glyph, color = WebInkSoft, fontSize = m.pill.sp, lineHeight = m.pillLine.sp, fontWeight = FontWeight(720), style = WebTextStyle)
            Text(label, fontSize = m.pill.sp, lineHeight = m.pillLine.sp, fontWeight = FontWeight(if (glyph != null) 900 else 720), style = WebTextStyle, maxLines = 1)
        }
    }
}

@Composable
private fun PhoneCalendarEntry(item: CalendarItem, selected: Boolean, zone: ZoneId, onClick: () -> Unit, modifier: Modifier = Modifier) {
    val entry = item.first
    val state = when (item) {
        is CalendarItem.Series -> item.entries.let { all ->
            when {
                all.all { it.hasFile } -> CalendarLibraryState.InLibrary
                all.any { it.monitored } -> CalendarLibraryState.Monitored
                else -> CalendarLibraryState.NotMonitored
            }
        }
        is CalendarItem.Single -> entry.libraryState()
    }
    val time = entry.releaseAt?.atZone(zone)?.let { "%02d:%02d".format(it.hour, it.minute) } ?: playarrString(PlayarrString.CalendarAllDay)
    val kind = CalendarMediaKind.fromWire(entry.mediaKind)
    val m = LocalCalendarMetrics.current
    val shape = RoundedCornerShape(m.entryRadius.dp)
    val ink = WebInk
    val fill = WebSurfaceStrong
    Surface(
        // Material's clickable Surface paints a focus state layer (a fill); web's focus state is the ring alone.
        modifier = modifier.padding(start = if (m === TvCalendarMetrics) 0.dp else 4.dp, end = if (m === TvCalendarMetrics) 0.dp else 8.dp).fillMaxWidth().height(m.entryHeight.dp).calendarClick(remember { MutableInteractionSource() }, onClick).calendarAvailabilityBorder(item.isAvailable(), m.entryRadius.dp).then(
            if (selected) {
                // `.calendar-entry.is-selected`: a 4 px left border and 1 px borders in ink, plus a 1 px inset ring, so the
                // padding box has a rounder inner left edge than the outer shape.
                Modifier.drawBehind {
                    val r = 12.dp.toPx()
                    val left = 4.dp.toPx()
                    val line = 1.dp.toPx()
                    drawRoundRect(ink, cornerRadius = androidx.compose.ui.geometry.CornerRadius(r))
                    val inner = androidx.compose.ui.graphics.Path().apply {
                        addRoundRect(
                            androidx.compose.ui.geometry.RoundRect(
                                left, line, size.width - line, size.height - line,
                                topLeftCornerRadius = androidx.compose.ui.geometry.CornerRadius(r - left, r - line),
                                topRightCornerRadius = androidx.compose.ui.geometry.CornerRadius(r - line),
                                bottomRightCornerRadius = androidx.compose.ui.geometry.CornerRadius(r - line),
                                bottomLeftCornerRadius = androidx.compose.ui.geometry.CornerRadius(r - left, r - line),
                            ),
                        )
                    }
                    drawPath(inner, fill)
                    clipPath(inner) {
                        drawPath(inner, ink, style = androidx.compose.ui.graphics.drawscope.Stroke(width = 2 * line))
                    }
                }
            } else {
                Modifier
            },
        ),
        shape = shape, color = if (selected) Color.Transparent else fill,
        border = if (selected) null else BorderStroke(1.dp, WebPillBorder),
    ) {
        Row(
            Modifier.padding(start = if (selected) 16.dp else 14.dp, end = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            CalendarPoster(entry.posterUrl, Modifier.size(width = m.poster.first.dp, height = m.poster.second.dp).clip(RoundedCornerShape(6.dp)))
            Column(Modifier.weight(1f).padding(start = 14.4.dp)) {
                Text(item.title, color = WebInk, fontSize = m.entryTitle.sp, lineHeight = m.entryTitleLine.sp, fontWeight = FontWeight(640), style = WebTextStyle, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Spacer(Modifier.height(2.4.dp))
                Text(calendarItemSubtitle(item), color = WebInkSoft, fontSize = m.entryTitle.sp, lineHeight = m.entryTitleLine.sp, style = WebTextStyle, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Spacer(Modifier.height(2.4.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text(time, color = WebInkMuted, fontSize = m.entryMeta.sp, lineHeight = m.entryMetaLine.sp, style = WebTextStyle)
                    Text(calendarReleaseTypeLabel(entry.releaseType), color = WebInkMuted, fontSize = m.entryMeta.sp, lineHeight = m.entryMetaLine.sp, style = WebTextStyle)
                    Text(
                        if (kind == CalendarMediaKind.Episode) playarrString(PlayarrString.CalendarDetailKindEpisode) else kind?.let { calendarKindLabel(it) } ?: entry.mediaKind,
                        color = WebInkMuted, fontSize = m.entryMeta.sp, lineHeight = m.entryMetaLine.sp, style = WebTextStyle,
                    )
                    if (m === TvCalendarMetrics) CalendarTonePill(calendarItemTone(item, LocalCalendarToday.current, zone))
                    else PhoneCalendarBadge(calendarStateLabel(state), m.entryMeta.sp, m.entryMetaLine.sp)
                }
            }
        }
    }
}

/** Web TV agenda: the period label, the selected release's details at the left and the day list at the right. */
@Composable
internal fun TvCalendarAgenda(
    state: CalendarUiState,
    groups: List<CalendarDayGroup>,
    loading: Boolean,
    selected: CalendarItem?,
    zone: ZoneId,
    locale: Locale,
    today: LocalDate,
    onSelect: (CalendarItem) -> Unit,
    onOpenWork: (String) -> Unit,
    onPlay: (String) -> Unit,
    actions: CalendarActionsHolder,
    onJump: () -> Unit,
) {
    androidx.compose.runtime.CompositionLocalProvider(LocalCalendarMetrics provides TvCalendarMetrics, LocalCalendarToday provides today) {
        androidx.compose.foundation.layout.BoxWithConstraints(Modifier.fillMaxSize()) {
            // Web: the date range lives in the header group; the details panel takes the library stage (eyebrow at y 259)
            // and the day list starts under the header. Both panes end at the bottom of the screen.
            val detailsTop = 259.dp
            val listTop = 168.dp
            // shortcut: the range label stays here until the shared header navigation pill can size to its label (web puts it there).
            val title = remember(state.window, state.mode, state.anchor, locale) { calendarRangeLabelShort(state.mode, state.anchor, state.window, locale) }
            Row(
                Modifier.offset(x = playarrPageMetrics(true).start, y = 160.dp).height(50.dp).clip(CircleShape).clickable(onClick = onJump).padding(horizontal = 21.dp),
                verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                Text(
                    title, color = WebInkSoft, fontSize = 14.4.sp, fontWeight = FontWeight(720), style = WebTextStyle, maxLines = 1,
                    modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
                )
                val ink = WebInkSoft
                androidx.compose.foundation.Canvas(Modifier.size(width = 9.dp, height = 8.dp)) {
                    val path = androidx.compose.ui.graphics.Path().apply { moveTo(0f, 0f); lineTo(size.width, 0f); lineTo(size.width / 2f, size.height); close() }
                    drawPath(path, ink)
                }
            }
            val detailScroll = rememberScrollState()
            Column(
                Modifier.offset(x = playarrPageMetrics(true).start, y = detailsTop).width(600.dp).height((maxHeight - detailsTop).coerceAtLeast(0.dp))
                    .calendarEdgeFades(detailScroll.verticalEdges())
                    .verticalScroll(detailScroll)
                    .padding(bottom = 48.dp),
            ) {
                when {
                    loading -> CalendarDetailSkeleton()
                    selected != null -> TvCalendarDetails(selected, locale, zone, today, onOpenWork, onPlay, actions)
                    else -> Text(playarrString(PlayarrString.CalendarSelectPrompt), color = WebInkMuted)
                }
            }
            val listState = rememberLazyListState()
            // Flat row model: day headings and entries share one lazy list; focus moves between entries only.
            val rows = remember(groups, zone) {
                buildList<Pair<LocalDate?, CalendarItem?>> {
                    groups.forEach { group ->
                        add(group.date to null)
                        groupSeriesEpisodes(group.entries, zone).forEach { add(null to it) }
                    }
                }
            }
            val entryKeys = remember(rows) { rows.mapNotNull { it.second?.let { item -> "agenda-${item.key}" } } }
            val lazyIndex = remember(rows) { rows.withIndex().filter { it.value.second != null }.associate { "agenda-${it.value.second!!.key}" to it.index } }
            val revealIndex = remember(rows) {
                rows.withIndex().filter { it.value.second != null && it.index > 0 && rows[it.index - 1].first != null }
                    .associate { "agenda-${it.value.second!!.key}" to it.index - 1 }
            }
            val focus = rememberCalendarListFocus(entryKeys, lazyIndex, revealIndex, listState)
            LazyColumn(
                state = listState,
                modifier = Modifier.offset(x = 786.dp, y = listTop).width(1049.dp).height((maxHeight - listTop).coerceAtLeast(0.dp))
                    .calendarEdgeFades(listState.verticalEdges()),
                contentPadding = PaddingValues(top = 4.dp, bottom = 48.dp),
            ) {
                if (loading) {
                    items(3) { Column(Modifier.padding(vertical = 4.dp)) { PlayarrSkeleton(Modifier.width(180.dp).height(18.dp)); Spacer(Modifier.height(8.dp)); CalendarRowSkeleton() } }
                } else {
                    rows.forEachIndexed { index, (day, item) ->
                        if (day != null) {
                            item(key = "day-$day") {
                                Row(Modifier.padding(top = if (index > 0) 25.dp else 0.dp, bottom = 37.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                                    Text(
                                        phoneCalendarDayHeading(day, locale), color = WebInk, fontSize = 18.7.sp, lineHeight = 28.sp, fontWeight = FontWeight(560),
                                        style = WebTextStyle, modifier = Modifier.semantics { heading() },
                                    )
                                    if (day == today) CalendarTodayBadge()
                                }
                            }
                        } else if (item != null) {
                            item(key = "entry-$index-${item.key}") {
                                PhoneCalendarEntry(
                                    item, selected = item.key == selected?.key, zone = zone, onClick = { onSelect(item) },
                                    // The details panel follows focus: UP/DOWN selects, SELECT is not needed.
                                    modifier = Modifier.calendarListRow(focus, "agenda-${item.key}", onFocused = { onSelect(item) }),
                                )
                                Spacer(Modifier.height(13.dp))
                            }
                        }
                    }
                }
            }
        }
    }
}

/** Period label: selectable, opens the month/year jump picker. */
@Composable
private fun CalendarPeriodLabel(state: CalendarUiState, isTelevision: Boolean, locale: Locale, onClick: () -> Unit) {
    Row(Modifier.fillMaxWidth().padding(bottom = 12.dp), verticalAlignment = Alignment.CenterVertically) {
        PlayarrButton(onClick = onClick, variant = PlayarrButtonVariant.Ghost, size = PlayarrButtonSize.Medium) {
            Text(
                calendarWindowTitle(state.mode, state.anchor, state.window, locale),
                color = WebInk,
                fontSize = if (isTelevision) 22.sp else 16.sp,
                fontWeight = FontWeight.SemiBold,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
            )
            Icon(Icons.Outlined.ArrowDropDown, contentDescription = playarrString(PlayarrString.CalendarJumpTo), tint = WebInk)
        }
    }
}

/** Fast month and year jump: two scrolling lists, D-pad friendly; choosing a month applies immediately. */
@Composable
private fun CalendarJumpDialog(anchor: LocalDate, locale: Locale, onDismiss: () -> Unit, onJump: (LocalDate) -> Unit) {
    var year by remember { mutableStateOf(anchor.year) }
    val years = remember { (anchor.year - 30..anchor.year + 30).toList() }
    val yearState = rememberLazyListState(initialFirstVisibleItemIndex = (years.indexOf(anchor.year) - 2).coerceAtLeast(0))
    val monthState = rememberLazyListState(initialFirstVisibleItemIndex = (anchor.monthValue - 2).coerceAtLeast(0))
    val focus = remember { FocusRequester() }
    PlayarrPanel(
        onDismissRequest = onDismiss,
        title = { Text(playarrString(PlayarrString.CalendarJumpTo)) },
        text = {
            Row(Modifier.fillMaxWidth().height(320.dp), horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                LazyColumn(Modifier.weight(1f), state = yearState, verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    items(years) { y ->
                        PlayarrChoice(y.toString(), y == year) { year = y }
                    }
                }
                LazyColumn(Modifier.weight(1.4f), state = monthState, verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    items(12) { index ->
                        val month = index + 1
                        val name = java.time.Month.of(month).getDisplayName(java.time.format.TextStyle.FULL_STANDALONE, locale)
                        PlayarrChoice(name, year == anchor.year && month == anchor.monthValue) { onJump(calendarJumpTarget(year, month)) }
                    }
                }
            }
        },
        confirmButton = {
            PlayarrButton(onClick = onDismiss, modifier = Modifier.focusRequester(focus)) {
                Text(playarrString(PlayarrString.CommonClose))
            }
        },
    )
    LaunchedEffect(Unit) { runCatching { focus.requestFocus() } }
}

// ---- Filters / subscription panels ----------------------------------------

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun CalendarFiltersSheet(
    state: CalendarUiState,
    sources: List<CalendarSourceStatus>,
    isTelevision: Boolean,
    holder: CalendarStateHolder,
) {
    val filters = state.filters
    var picking by remember { mutableStateOf<Boolean?>(null) }
    PlayarrFiltersSheet(
        title = playarrString(PlayarrString.LibraryFilters),
        kicker = playarrString(PlayarrString.CalendarTitle),
        closeLabel = playarrString(PlayarrString.LibraryCloseFilters),
        onClose = { holder.openPanel(null) },
    ) {
        PlayarrFilterSection(playarrString(PlayarrString.CalendarView)) {
            PlayarrViewToggle(
                options = CalendarViewMode.entries.map { it to calendarModeLabel(it) },
                value = state.mode,
                onChange = holder::setMode,
            )
        }
        PlayarrFilterSection(playarrString(PlayarrString.CalendarFilterType)) {
            PlayarrMultiSelect(
                options = CalendarType.entries.map { it to calendarKindLabel(it.kind) },
                selected = filters.types,
                onChange = { holder.setFilters(filters.copy(types = it)) },
            )
        }
        if (sources.isNotEmpty()) {
            PlayarrFilterSection(playarrString(PlayarrString.CalendarFilterSource)) {
                PlayarrMultiSelect(
                    options = sources.map { it.sourceInstanceId to it.name },
                    selected = filters.sources,
                    onChange = { holder.setFilters(filters.copy(sources = it)) },
                )
            }
        }
        PlayarrFilterSection(playarrString(PlayarrString.CalendarFilterStatus)) {
            PlayarrMultiSelect(
                options = CalendarStatus.entries.map { it to calendarStatusLabel(it) },
                selected = filters.statuses,
                onChange = { holder.setFilters(filters.copy(statuses = it)) },
            )
        }
        PlayarrFilterSection(playarrString(PlayarrString.CalendarFilterRange)) {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                val fmt = remember { DateTimeFormatter.ofLocalizedDate(FormatStyle.MEDIUM) }
                PlayarrChoice(
                    filters.from?.let { "${playarrString(PlayarrString.CalendarRangeFrom)}: ${fmt.format(it)}" }
                        ?: playarrString(PlayarrString.CalendarRangePickFrom),
                    filters.from != null,
                ) { picking = true }
                PlayarrChoice(
                    filters.to?.let { "${playarrString(PlayarrString.CalendarRangeTo)}: ${fmt.format(it)}" }
                        ?: playarrString(PlayarrString.CalendarRangePickTo),
                    filters.to != null,
                ) { picking = false }
                if (filters.from != null || filters.to != null) {
                    PlayarrChoice(playarrString(PlayarrString.CalendarRangeClear), false) {
                        holder.setFilters(filters.copy(from = null, to = null))
                    }
                }
            }
        }
        PlayarrFilterSection(playarrString(PlayarrString.CalendarFilterMonitoring)) {
            PlayarrMultiSelect(
                options = listOf(true to playarrString(PlayarrString.CalendarMonitoredOnly)),
                selected = if (filters.monitoredOnly) setOf(true) else emptySet(),
                onChange = { holder.setFilters(filters.copy(monitoredOnly = true in it)) },
            )
        }
        if (filters.activeCount > 0) {
            PlayarrChoice(playarrString(PlayarrString.CalendarClearFilters), false, holder::clearFilters)
        }
    }
    picking?.let { isFrom ->
        val initial = (if (isFrom) filters.from else filters.to) ?: state.anchor
        val pickerState = rememberDatePickerState(
            initialSelectedDateMillis = initial.atStartOfDay(ZoneId.of("UTC")).toInstant().toEpochMilli(),
        )
        PlayarrPanel(
            onDismissRequest = { picking = null },
            confirmButton = {
                PlayarrButton(variant = PlayarrButtonVariant.Ghost, onClick = {
                    val day = pickerState.selectedDateMillis?.let { Instant.ofEpochMilli(it).atZone(ZoneId.of("UTC")).toLocalDate() }
                    if (day != null) {
                        val next = if (isFrom) filters.copy(from = day) else filters.copy(to = day)
                        holder.setFilters(
                            if (next.from != null && next.to != null && next.from.isAfter(next.to)) next.copy(from = next.to, to = next.from) else next,
                        )
                        if (isFrom) holder.showDay(state.mode, day)
                    }
                    picking = null
                }) { Text(playarrString(PlayarrString.CommonDone)) }
            },
            dismissButton = { PlayarrButton(variant = PlayarrButtonVariant.Ghost, onClick = { picking = null }) { Text(playarrString(PlayarrString.CommonCancel)) } },
            text = { DatePicker(state = pickerState) },
        )
    }
}

private enum class SubscriptionConfirm { Reset }

/** The personal calendar link: created on first open, then Copy, QR, instructions and a confirmed Reset. */
@Composable
private fun CalendarSubscriptionSheet(
    holder: CalendarSubscriptionHolder,
    isTelevision: Boolean,
    locale: Locale,
    onDismiss: () -> Unit,
) {
    val state by holder.state.collectAsState()
    var confirmReset by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) { holder.ensureLink() }
    val created = state.created
    PlayarrFiltersSheet(
        title = playarrString(PlayarrString.CalendarLinkTitle),
        kicker = playarrString(PlayarrString.CalendarTitle),
        closeLabel = playarrString(PlayarrString.CommonClose),
        onClose = onDismiss,
        footer = {
            if (state.status?.active == true || created != null) {
                PlayarrButton(
                    onClick = { confirmReset = true },
                    variant = PlayarrButtonVariant.Secondary,
                    size = PlayarrButtonSize.Small,
                    enabled = !state.busy,
                ) { Text(playarrString(PlayarrString.CalendarLinkReset)) }
            }
        },
    ) {
        Text(playarrString(PlayarrString.CalendarLinkIntro), color = WebInkMuted, fontSize = 13.sp)
        when {
            created != null -> CalendarCreatedLink(created.url, isTelevision)
            state.error != null -> Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text(playarrText(state.error!!), color = MaterialTheme.colorScheme.error, fontSize = 13.sp)
                PlayarrButton(onClick = holder::ensureLink, variant = PlayarrButtonVariant.Secondary, size = PlayarrButtonSize.Small) {
                    Text(playarrString(PlayarrString.CommonTryAgain))
                }
            }
            state.loading || state.busy -> Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                CircularProgressIndicator(color = WebAccent, modifier = Modifier.size(20.dp))
                Text(playarrString(PlayarrString.CalendarLinkPreparing), color = WebInkMuted, fontSize = 13.sp)
            }
            state.status?.active == true -> Text(playarrString(PlayarrString.CalendarLinkHidden), color = WebInkMuted, fontSize = 13.sp)
        }
        PlayarrFilterSection(playarrString(PlayarrString.CalendarSubscribeInstructionsTitle)) {
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                listOf(
                    PlayarrString.CalendarSubscribeInstructionGoogle,
                    PlayarrString.CalendarSubscribeInstructionApple,
                    PlayarrString.CalendarSubscribeInstructionOutlook,
                ).forEach { Text(playarrString(it), color = WebInkSoft, fontSize = 13.sp) }
            }
        }
    }
    if (confirmReset) {
        PlayarrPanel(
            onDismissRequest = { confirmReset = false },
            title = { Text(playarrString(PlayarrString.CalendarLinkResetTitle)) },
            text = { Text(playarrString(PlayarrString.CalendarLinkResetBody)) },
            confirmButton = {
                PlayarrButton(
                    onClick = { confirmReset = false; holder.createOrRegenerate() },
                ) { Text(playarrString(PlayarrString.CalendarLinkReset)) }
            },
            dismissButton = {
                PlayarrButton(onClick = { confirmReset = false }, variant = PlayarrButtonVariant.Ghost) {
                    Text(playarrString(PlayarrString.CommonCancel))
                }
            },
        )
    }
}

@Composable
private fun calendarStatusLabel(status: CalendarStatus): String = playarrString(
    when (status) {
        CalendarStatus.Aired -> PlayarrString.CalendarStatusAired
        CalendarStatus.Upcoming -> PlayarrString.CalendarStatusUpcoming
        CalendarStatus.Downloaded -> PlayarrString.CalendarStatusDownloaded
        CalendarStatus.Missing -> PlayarrString.CalendarStatusMissing
    },
)

// ---- Views -----------------------------------------------------------------

private val CalendarRowSpacing = 16.dp

/** Agenda: details of the selected release on the LEFT, the day-by-day list on the RIGHT. */
@Composable
private fun CalendarAgenda(
    groups: List<CalendarDayGroup>,
    loading: Boolean,
    selected: CalendarItem?,
    isTelevision: Boolean,
    today: LocalDate,
    zone: ZoneId,
    locale: Locale,
    onSelect: (CalendarItem) -> Unit,
    onOpenWork: (String) -> Unit,
    actions: CalendarActionsHolder,
    modifier: Modifier,
) {
    PlayarrMasterDetail(
        isTelevision = isTelevision,
        modifier = modifier,
        detail = {
            when {
                loading -> CalendarDetailSkeleton()
                selected != null -> CalendarItemDetails(selected, locale, zone, onOpenWork, actions)
                else -> Text(playarrString(PlayarrString.CalendarSelectPrompt), color = WebInkMuted)
            }
        },
        list = {
            LazyColumn(
                Modifier.fillMaxSize(),
                contentPadding = PaddingValues(top = 4.dp, bottom = 24.dp),
                verticalArrangement = Arrangement.spacedBy(CalendarRowSpacing),
            ) {
                if (loading) {
                    items(3) { index ->
                        Column(verticalArrangement = Arrangement.spacedBy(CalendarRowSpacing)) {
                            PlayarrSkeleton(Modifier.width(180.dp).height(18.dp))
                            repeat(1 + index % 2) { CalendarRowSkeleton() }
                        }
                    }
                } else {
                    groups.forEach { group ->
                        item(key = "day-${group.date}") { CalendarDayHeading(group.date, today, locale, isTelevision) }
                        items(groupSeriesEpisodes(group.entries, zone), key = { "${group.date}-${it.key}" }) { item ->
                            CalendarItemRow(item, selected = item.key == selected?.key, isTelevision = isTelevision, zone = zone, onClick = { onSelect(item) })
                        }
                    }
                }
            }
        },
    )
}

/**
 * Week: wide day columns on a sideways track. D-pad LEFT/RIGHT moves between days and UP/DOWN between the entries of a
 * day (web `data-tv-nav-geometric`); the focused entry is always scrolled into view, and every side that continues
 * shows the web edge fade.
 */
@Composable
internal fun CalendarWeek(
    groups: List<CalendarDayGroup>,
    loading: Boolean,
    isTelevision: Boolean,
    today: LocalDate,
    zone: ZoneId,
    locale: Locale,
    selectedKey: String?,
    onSelect: (CalendarItem) -> Unit,
    modifier: Modifier,
) {
    val columnWidth = if (isTelevision) 400.dp else 296.dp
    val skeletonDays = remember(groups) { if (groups.isEmpty()) 7 else groups.size }
    val dayItems = remember(groups, zone) { groups.map { groupSeriesEpisodes(it.entries, zone) } }
    val counts = remember(dayItems) { dayItems.map { it.size } }
    val requesters = remember(dayItems) { dayItems.map { column -> column.map { FocusRequester() } } }
    val track = rememberScrollState()
    val columnScroll = remember(groups.size) { List(groups.size) { ScrollState(0) } }
    Box(modifier.calendarEdgeFades(track.horizontalEdges())) {
        Row(
            Modifier.fillMaxSize().horizontalScroll(track).padding(end = 24.dp),
            horizontalArrangement = Arrangement.spacedBy(20.dp),
        ) {
            if (loading) {
                repeat(skeletonDays) { index ->
                    Column(Modifier.width(columnWidth), verticalArrangement = Arrangement.spacedBy(CalendarRowSpacing)) {
                        PlayarrSkeleton(Modifier.width(160.dp).height(18.dp))
                        repeat(1 + index % 2) { CalendarRowSkeleton() }
                    }
                }
            } else {
                groups.forEachIndexed { column, group ->
                    val scroll = columnScroll[column]
                    Column(
                        Modifier.width(columnWidth).fillMaxHeight()
                            .calendarEdgeFades(scroll.verticalEdges())
                            .verticalScroll(scroll)
                            .padding(top = 4.dp, bottom = 48.dp),
                        verticalArrangement = Arrangement.spacedBy(CalendarRowSpacing),
                    ) {
                        CalendarDayHeading(group.date, today, locale, isTelevision)
                        if (group.entries.isEmpty()) {
                            Text(playarrString(PlayarrString.CalendarEmptyDay), color = WebInkMuted, fontSize = 12.sp)
                        } else {
                            dayItems[column].forEachIndexed { row, item ->
                                CalendarItemRow(
                                    item, selected = item.key == selectedKey, isTelevision = isTelevision, zone = zone, wrapTitle = true,
                                    onClick = { onSelect(item) },
                                    modifier = Modifier
                                        .focusRequester(requesters[column][row])
                                        .calendarDpad { key ->
                                            val target = calendarWeekNeighbour(counts, CalendarSlot(column, row), key)
                                            if (target != null) {
                                                runCatching { requesters[target.column][target.row].requestFocus() }
                                                true
                                            } else {
                                                calendarConsumesAtEdge(key)
                                            }
                                        }
                                        .calendarFocusReveal(),
                                )
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun CalendarRowSkeleton() {
    Row(Modifier.fillMaxWidth().heightIn(min = 72.dp).padding(10.dp), verticalAlignment = Alignment.CenterVertically) {
        PlayarrSkeleton(Modifier.size(width = 44.dp, height = 64.dp))
        Column(Modifier.weight(1f).padding(start = 12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            PlayarrSkeleton(Modifier.fillMaxWidth(0.6f).height(16.dp))
            PlayarrSkeleton(Modifier.fillMaxWidth(0.4f).height(12.dp))
        }
    }
}

@Composable
private fun CalendarDetailSkeleton() {
    Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
        PlayarrSkeleton(Modifier.size(width = 120.dp, height = 176.dp))
        PlayarrSkeleton(Modifier.fillMaxWidth(0.8f).height(28.dp))
        PlayarrSkeleton(Modifier.fillMaxWidth(0.5f).height(16.dp))
        PlayarrSkeleton(Modifier.fillMaxWidth().height(14.dp))
        PlayarrSkeleton(Modifier.fillMaxWidth(0.7f).height(14.dp))
    }
}

@Composable
private fun calendarItemSubtitle(item: CalendarItem): String = when (item) {
    is CalendarItem.Series -> playarrString(PlayarrString.CalendarGroupSummary, "count" to item.entries.size, "codes" to item.codes)
    is CalendarItem.Single -> calendarEntryDetail(item.entry)
}

@Composable
private fun CalendarItemRow(
    item: CalendarItem,
    selected: Boolean,
    isTelevision: Boolean,
    zone: ZoneId,
    onClick: () -> Unit,
    wrapTitle: Boolean = false,
    modifier: Modifier = Modifier,
) {
    val source = remember { MutableInteractionSource() }
    val shape = RoundedCornerShape(12.dp)
    val entry = item.first
    val state = when (item) {
        is CalendarItem.Series -> item.entries.let { all ->
            when {
                all.all { it.hasFile } -> CalendarLibraryState.InLibrary
                all.any { it.monitored } -> CalendarLibraryState.Monitored
                else -> CalendarLibraryState.NotMonitored
            }
        }
        is CalendarItem.Single -> entry.libraryState()
    }
    val stateLabel = calendarStateLabel(state)
    val subtitle = calendarItemSubtitle(item)
    val time = entry.releaseAt?.atZone(zone)?.let { "%02d:%02d".format(it.hour, it.minute) }
        ?: playarrString(PlayarrString.CalendarAllDay)
    val description = playarrString(PlayarrString.CalendarEntryDescription, "title" to item.title, "detail" to subtitle, "state" to stateLabel)
    Surface(
        color = if (selected) WebPink.copy(alpha = 0.18f) else WebSurfaceSoft.copy(alpha = 0.62f),
        shape = shape,
        border = if (selected) BorderStroke(1.5.dp, WebInk) else null,
        modifier = modifier
            .fillMaxWidth()
            .heightIn(min = 72.dp)
            .calendarFocusRing(source, shape)
            .calendarClick(source, onClick)
            .calendarAvailabilityBorder(item.isAvailable(), 12.dp)
            .semantics(mergeDescendants = true) { contentDescription = description },
    ) {
        Row(Modifier.padding(start = 14.dp, top = 10.dp, end = 10.dp, bottom = 10.dp), verticalAlignment = Alignment.CenterVertically) {
            CalendarPoster(entry.posterUrl, Modifier.size(width = 44.dp, height = 64.dp))
            Column(Modifier.weight(1f).padding(horizontal = 12.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(
                    item.title,
                    color = WebInk,
                    fontWeight = FontWeight.SemiBold,
                    fontSize = if (isTelevision) 18.sp else 15.sp,
                    maxLines = if (wrapTitle) 3 else 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Text(subtitle, color = WebInkSoft, fontSize = if (isTelevision) 14.sp else 12.sp, maxLines = 2, overflow = TextOverflow.Ellipsis)
                Text("$time · $stateLabel", color = WebInkMuted, fontSize = if (isTelevision) 13.sp else 11.sp)
            }
        }
    }
}

/** Details of the selected release: facts plus Open when it exists in the library. */
@Composable
internal fun CalendarItemDetails(item: CalendarItem, locale: Locale, zone: ZoneId, onOpenWork: (String) -> Unit, actions: CalendarActionsHolder) {
    val entry = item.first
    val time = remember(entry.releaseAt, locale) { entry.localReleaseTime(zone, locale) }
    val workId = entry.openWorkId
    Column(verticalArrangement = Arrangement.spacedBy(12.dp), modifier = Modifier.padding(bottom = 24.dp)) {
        CalendarPoster(entry.posterUrl, Modifier.size(width = 120.dp, height = 176.dp))
        Text(item.title, color = WebInk, fontSize = 28.sp, fontWeight = FontWeight(590), modifier = Modifier.semantics { heading() })
        Text(calendarItemSubtitle(item), color = WebInkSoft, fontSize = 14.sp)
        Text(
            time?.let { playarrString(PlayarrString.CalendarReleasesAt, "time" to it) }
                ?: "${formatCalendarDay(entry.date, locale)} · ${playarrString(PlayarrString.CalendarAllDay)}",
            color = WebInk,
            fontSize = 14.sp,
        )
        if (item is CalendarItem.Series) {
            Text(playarrString(PlayarrString.CalendarEpisodes), color = WebInk, fontWeight = FontWeight.SemiBold, modifier = Modifier.semantics { heading() })
            item.entries.forEach { ep ->
                Text(
                    "${ep.episodeCode().orEmpty()}  ${ep.subtitle ?: ep.title}  ·  ${calendarStateLabel(ep.libraryState())}",
                    color = WebInkSoft,
                    fontSize = 13.sp,
                )
            }
        } else {
            Text(calendarStateLabel(entry.libraryState()), color = WebAccent, fontWeight = FontWeight.SemiBold, fontSize = 14.sp)
        }
        entry.averageLagSeconds?.takeIf { it > 0 }?.let {
            Text(
                playarrString(PlayarrString.AvailabilityLagUsually, "duration" to calendarLagText(it)),
                color = WebInkMuted,
                fontSize = 12.sp,
            )
        }
        // No source list: users never see source-provider names (owner rule 2026-10-09).
        if (workId != null) {
            PlayarrButton(onClick = { onOpenWork(workId) }) {
                Text(playarrString(if (item is CalendarItem.Series) PlayarrString.CalendarOpenSeries else PlayarrString.CalendarOpen))
            }
            // The server may offer Watchlist (or Request) beside Open, for example for an unaired episode of a
            // series already in the library; show exactly what it enabled.
            CalendarEntryActions(entry, actions)
        } else {
            Text(playarrString(PlayarrString.CalendarNotInCatalogue), color = WebInkMuted, fontSize = 12.sp)
            CalendarEntryActions(entry, actions)
        }
    }
}

/** Request and watchlist for a release that is not in the library, exactly as the server offered them. */
@Composable
private fun CalendarEntryActions(entry: io.playarr.shared.data.model.CalendarEntry, holder: CalendarActionsHolder) {
    val snapshot = entry.snapshot ?: return
    val state by holder.state.collectAsState()
    val request = entry.action(io.playarr.shared.data.model.CalendarAction.REQUEST)
    val watchlist = entry.action(io.playarr.shared.data.model.CalendarAction.WATCHLIST)?.takeIf { it.enabled }
    val busy = snapshot in state.busy
    if (request != null) {
        val requested = request.active || snapshot in state.requested
        PlayarrButton(onClick = { holder.request(snapshot) }, enabled = request.enabled && !requested && !busy) {
            Text(playarrString(if (requested) PlayarrString.DiscoveryRequested else PlayarrString.DiscoveryActionRequest))
        }
        if (!request.enabled && !requested) {
            request.reason?.let { Text(it, color = WebInkMuted, fontSize = 12.sp) }
        }
    }
    if (watchlist != null) {
        val listed = state.listed[snapshot] ?: watchlist.active
        PlayarrButton(
            onClick = { holder.toggleWatchlist(snapshot, listed) },
            variant = PlayarrButtonVariant.Secondary,
            enabled = !busy,
        ) { Text(playarrString(if (listed) PlayarrString.WatchlistRemove else PlayarrString.WatchlistAdd)) }
    }
    state.error?.let { Text(playarrText(it), color = MaterialTheme.colorScheme.error, fontSize = 12.sp) }
}

/** Month and week selections open the same details in a dialog (agenda shows them in its left pane). */
@Composable
private fun CalendarItemDialog(
    item: CalendarItem,
    isTelevision: Boolean,
    locale: Locale,
    zone: ZoneId,
    onDismiss: () -> Unit,
    onOpenWork: (String) -> Unit,
    actions: CalendarActionsHolder,
) {
    val focus = remember { FocusRequester() }
    PlayarrPanel(
        onDismissRequest = onDismiss,
        text = { Box(Modifier.heightIn(max = if (isTelevision) 520.dp else 480.dp).verticalScroll(rememberScrollState())) { CalendarItemDetails(item, locale, zone, onOpenWork, actions) } },
        confirmButton = {
            PlayarrButton(onClick = onDismiss, modifier = Modifier.focusRequester(focus)) { Text(playarrString(PlayarrString.CommonClose)) }
        },
    )
    LaunchedEffect(Unit) { runCatching { focus.requestFocus() } }
}

@Composable
internal fun CalendarMonth(
    state: CalendarUiState,
    entries: List<CalendarEntry>,
    loading: Boolean,
    isTelevision: Boolean,
    today: LocalDate,
    zone: ZoneId,
    locale: Locale,
    onSelectDay: (LocalDate?) -> Unit,
    onSelect: (CalendarItem) -> Unit,
    modifier: Modifier,
    onMore: (LocalDate) -> Unit = {},
) {
    val counts = remember(entries) { calendarEntryCountsByDay(entries, emptySet()) }
    val rows = remember(state.window) { calendarGridRows(state.window) }
    val firstDay = remember(locale) { firstDayOfWeek(locale) }
    val selected = state.selectedDay
    val dayItems = remember(entries, selected) {
        selected?.let { day -> groupSeriesEpisodes(entries.filter { it.date == day }.sortedBy { it.releaseAt }, zone) }.orEmpty()
    }
    val cells = remember(rows) { rows.flatten() }
    val cellRequesters = remember(cells) { cells.map { FocusRequester() } }
    val listState = rememberLazyListState()
    val itemKeys = remember(dayItems) { dayItems.map { "month-${it.key}" } }
    // Index 0 of the lazy list is the day heading, so entry i sits at i + 1.
    val lazyIndex = remember(itemKeys) { itemKeys.withIndex().associate { it.value to it.index + 1 } }
    val listFocus = rememberCalendarListFocus(itemKeys, lazyIndex, emptyMap(), listState)
    val gridScroll = rememberScrollState()
    BoxWithConstraints(modifier) {
        val wide = isTelevision || maxWidth >= 840.dp
        if (wide) {
            // Web `.calendar-month`: chips inside the day cells, filling the space below the header.
            CalendarMonthChips(state, entries, loading, today, zone, locale, onSelect, onMore, Modifier.fillMaxSize().padding(top = 8.dp))
            return@BoxWithConstraints
        }
        val grid: @Composable (Modifier) -> Unit = { gridModifier ->
            Column(gridModifier, verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Row(Modifier.fillMaxWidth()) {
                    calendarWeekdayLabels(firstDay, locale).forEach { label ->
                        Text(label, color = WebInkMuted, fontSize = 11.sp, textAlign = TextAlign.Center, modifier = Modifier.weight(1f))
                    }
                }
                rows.forEachIndexed { rowIndex, week ->
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                        week.forEachIndexed { columnIndex, day ->
                            val cell = rowIndex * 7 + columnIndex
                            CalendarDayCell(
                                day = day,
                                count = if (loading) 0 else counts[day] ?: 0,
                                inMonth = day.month == state.anchor.month,
                                isToday = day == today,
                                selected = day == selected,
                                isTelevision = isTelevision,
                                locale = locale,
                                onClick = { onSelectDay(day) },
                                modifier = Modifier
                                    .weight(1f)
                                    .focusRequester(cellRequesters[cell])
                                    .calendarDpad { key ->
                                        val target = calendarMonthNeighbour(cell, rows.size, 7, key)
                                        when {
                                            target != null -> {
                                                runCatching { cellRequesters[target].requestFocus() }
                                                true
                                            }
                                            // RIGHT from the last column enters the day's entries.
                                            key == CalendarKey.Right && itemKeys.isNotEmpty() && selected != null -> {
                                                listFocus.focus(itemKeys.first())
                                                true
                                            }
                                            else -> calendarConsumesAtEdge(key)
                                        }
                                    }
                                    .calendarFocusReveal(onFocused = { onSelectDay(day) }),
                            )
                        }
                    }
                }
            }
        }
        val dayList: LazyListScope.() -> Unit = {
            if (selected != null) {
                item(key = "month-day-heading") { CalendarDayHeading(selected, today, locale, isTelevision) }
                itemsIndexed(dayItems, key = { _, it -> it.key }) { _, item ->
                    CalendarItemRow(
                        item, selected = item.key == state.selectedKey, isTelevision = isTelevision, zone = zone, onClick = { onSelect(item) },
                        modifier = Modifier.calendarListRow(
                            listFocus, "month-${item.key}",
                            // LEFT returns to the grid, on the selected day.
                            onSide = { key ->
                                if (key == CalendarKey.Left) {
                                    val back = cells.indexOf(selected).takeIf { it >= 0 } ?: 0
                                    runCatching { cellRequesters[back].requestFocus() }
                                    true
                                } else {
                                    true
                                }
                            },
                        ),
                    )
                }
            }
        }
        if (wide) {
            Row(Modifier.fillMaxSize().padding(top = 8.dp), horizontalArrangement = Arrangement.spacedBy(24.dp)) {
                grid(Modifier.weight(1.4f).fillMaxHeight().calendarEdgeFades(gridScroll.verticalEdges()).verticalScroll(gridScroll).padding(bottom = 48.dp))
                LazyColumn(
                    Modifier.weight(1f).fillMaxSize().calendarEdgeFades(listState.verticalEdges()), state = listState,
                    contentPadding = PaddingValues(bottom = 48.dp), verticalArrangement = Arrangement.spacedBy(CalendarRowSpacing),
                ) { dayList() }
            }
        } else {
            LazyColumn(
                Modifier.fillMaxSize().calendarEdgeFades(listState.verticalEdges()), state = listState,
                contentPadding = PaddingValues(bottom = 24.dp, top = 8.dp), verticalArrangement = Arrangement.spacedBy(CalendarRowSpacing),
            ) {
                item(key = "month-grid") { grid(Modifier.fillMaxWidth()) }
                dayList()
            }
        }
    }
}

/**
 * Month view as on web: seven columns, each day cell holds its entries as chips (availability border, one line of
 * title) and as many as fit, then "+N more", which opens the agenda on that day. Chips and "+N more" are the focus
 * stops; the rules are [calendarMonthChipNeighbour].
 */
@Composable
private fun CalendarMonthChips(
    state: CalendarUiState,
    entries: List<CalendarEntry>,
    loading: Boolean,
    today: LocalDate,
    zone: ZoneId,
    locale: Locale,
    onSelect: (CalendarItem) -> Unit,
    onMore: (LocalDate) -> Unit,
    modifier: Modifier,
) {
    val rows = remember(state.window) { calendarGridRows(state.window) }
    val cells = remember(rows) { rows.flatten() }
    val firstDay = remember(locale) { firstDayOfWeek(locale) }
    val byDay = remember(entries, zone) {
        entries.groupBy { it.date }.mapValues { (_, day) -> groupSeriesEpisodes(day.sortedBy { it.releaseAt }, zone) }
    }
    androidx.compose.foundation.layout.BoxWithConstraints(modifier) {
        val headerHeight = 26.dp
        val cellHeight = (maxHeight - headerHeight) / rows.size
        // Web: chips that fit = (cell height - 52) / 26, between 1 and 5; when more exist the last slot is "+N more".
        val limit = ((cellHeight.value - 52f) / 26f).toInt().coerceIn(1, 5)
        val visible = remember(cells, byDay, limit, loading) {
            cells.map { day ->
                val items = if (loading) emptyList() else byDay[day].orEmpty()
                val shown = if (items.size > limit) items.take(maxOf(1, limit - 1)) else items
                shown to (items.size - shown.size)
            }
        }
        val slots = remember(visible) { visible.map { (shown, hidden) -> shown.size + if (hidden > 0) 1 else 0 } }
        val requesters = remember(slots) { slots.map { n -> List(n) { FocusRequester() } } }
        Column(Modifier.fillMaxSize()) {
            Row(Modifier.fillMaxWidth().height(headerHeight)) {
                calendarWeekdayLabels(firstDay, locale).forEach { label ->
                    Text(label.uppercase(locale), color = WebInkMuted, fontSize = 12.sp, letterSpacing = 1.sp, textAlign = TextAlign.Center, modifier = Modifier.weight(1f))
                }
            }
            rows.forEachIndexed { rowIndex, week ->
                Row(Modifier.weight(1f).fillMaxWidth()) {
                    week.forEachIndexed { columnIndex, day ->
                        val cell = rowIndex * 7 + columnIndex
                        val (shown, hidden) = visible[cell]
                        val inMonth = day.month == state.anchor.month
                        fun handleKey(slot: Int): (CalendarKey) -> Boolean = { key ->
                            val target = calendarMonthChipNeighbour(slots, 7, CalendarSlot(cell, slot), key)
                            if (target != null) {
                                runCatching { requesters[target.column][target.row].requestFocus() }
                                true
                            } else {
                                calendarConsumesAtEdge(key)
                            }
                        }
                        Column(
                            Modifier.weight(1f).fillMaxHeight()
                                .background(if (inMonth) Color.Transparent else WebSurfaceSoft.copy(alpha = 0.4f))
                                .border(1.dp, WebPillBorder)
                                .then(if (day == today) Modifier.border(2.dp, WebPink) else Modifier)
                                .padding(5.dp),
                            verticalArrangement = Arrangement.spacedBy(2.dp),
                        ) {
                            Text(
                                day.dayOfMonth.toString(), color = if (inMonth) WebInk else WebInkMuted,
                                fontSize = 13.sp, fontWeight = FontWeight(640), modifier = Modifier.padding(bottom = 3.dp),
                            )
                            shown.forEachIndexed { slot, item ->
                                CalendarChip(
                                    item, onClick = { onSelect(item) },
                                    modifier = Modifier.focusRequester(requesters[cell][slot]).calendarDpad(handleKey(slot)).calendarFocusReveal(),
                                )
                            }
                            if (hidden > 0) {
                                val slot = shown.size
                                val source = remember { MutableInteractionSource() }
                                androidx.compose.runtime.CompositionLocalProvider(
                                    androidx.compose.material3.LocalMinimumInteractiveComponentSize provides androidx.compose.ui.unit.Dp.Unspecified,
                                ) {
                                Surface(
                                    onClick = { onMore(day) }, color = Color.Transparent, contentColor = WebInkSoft,
                                    shape = RoundedCornerShape(4.dp), interactionSource = source,
                                    modifier = Modifier.fillMaxWidth().height(24.dp)
                                        .focusRequester(requesters[cell][slot]).calendarDpad(handleKey(slot)).calendarFocusReveal()
                                        .calendarFocusRing(source, RoundedCornerShape(4.dp)),
                                ) {
                                    Box(Modifier.padding(horizontal = 6.dp), contentAlignment = Alignment.CenterStart) {
                                        Text(playarrString(PlayarrString.CalendarMore, "count" to hidden), fontSize = 12.sp, maxLines = 1)
                                    }
                                }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

/** Web `.calendar-chip`: 24 dp, 3 dp availability border, one line of title (series groups read "Title · 3x"). */
@Composable
private fun CalendarChip(item: CalendarItem, onClick: () -> Unit, modifier: Modifier = Modifier) {
    val source = remember { MutableInteractionSource() }
    val shape = RoundedCornerShape(4.dp)
    val label = when (item) {
        is CalendarItem.Series -> "${item.title} · ${item.entries.size}×"
        is CalendarItem.Single -> item.title
    }
    // Material would grow a clickable surface to a 48 dp touch target; the web chip is 24 dp.
    androidx.compose.runtime.CompositionLocalProvider(
        androidx.compose.material3.LocalMinimumInteractiveComponentSize provides androidx.compose.ui.unit.Dp.Unspecified,
    ) {
    Surface(
        color = WebSurfaceSoft, contentColor = WebInk, shape = shape,
        modifier = modifier.fillMaxWidth().height(24.dp)
            .calendarFocusRing(source, shape)
            .calendarClick(source, onClick)
            .calendarAvailabilityBorder(item.isAvailable(), radius = 4.dp, width = 3.dp)
            .semantics(mergeDescendants = true) { contentDescription = label },
    ) {
        Box(Modifier.padding(start = 9.dp, end = 6.dp), contentAlignment = Alignment.CenterStart) {
            Text(label, fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
    }
    }
}

@Composable
private fun calendarKindLabel(kind: CalendarMediaKind): String = playarrString(
    when (kind) {
        CalendarMediaKind.Episode -> PlayarrString.CalendarKindEpisode
        CalendarMediaKind.Movie -> PlayarrString.CalendarKindMovie
        CalendarMediaKind.Album -> PlayarrString.CalendarKindAlbum
        CalendarMediaKind.Book -> PlayarrString.CalendarKindBook
    },
)

@Composable
private fun calendarReleaseTypeLabel(type: String): String = playarrString(
    when (type) {
        "air" -> PlayarrString.CalendarReleaseAir
        "cinema" -> PlayarrString.CalendarReleaseCinema
        "digital" -> PlayarrString.CalendarReleaseDigital
        "physical" -> PlayarrString.CalendarReleasePhysical
        else -> PlayarrString.CalendarReleaseGeneric
    },
)

@Composable
private fun calendarStateLabel(state: CalendarLibraryState): String = playarrString(
    when (state) {
        CalendarLibraryState.InLibrary -> PlayarrString.CalendarStateInLibrary
        CalendarLibraryState.Monitored -> PlayarrString.CalendarStateMonitored
        CalendarLibraryState.NotMonitored -> PlayarrString.CalendarStateNotMonitored
    },
)

@Composable
private fun calendarModeLabel(mode: CalendarViewMode): String = playarrString(
    when (mode) {
        CalendarViewMode.Agenda -> PlayarrString.CalendarViewAgenda
        CalendarViewMode.Week -> PlayarrString.CalendarViewWeek
        CalendarViewMode.Month -> PlayarrString.CalendarViewMonth
    },
)

@Composable
internal fun calendarLagText(seconds: Long): String {
    val lag = lagDuration(seconds)
    val key = when (lag.unit) {
        LagUnit.Days -> if (lag.count == 1L) PlayarrString.DurationDaysOne else PlayarrString.DurationDaysOther
        LagUnit.Hours -> if (lag.count == 1L) PlayarrString.DurationHoursOne else PlayarrString.DurationHoursOther
        LagUnit.Minutes -> if (lag.count == 1L) PlayarrString.DurationMinutesOne else PlayarrString.DurationMinutesOther
    }
    return playarrString(key, "count" to lag.count)
}

/** Clickable without a state layer: web's calendar entries show the ring on focus and no fill. */
private fun Modifier.calendarClick(source: MutableInteractionSource, onClick: () -> Unit): Modifier =
    this.clickable(interactionSource = source, indication = null, onClick = onClick)

/** Visible focus indicator for D-pad users; touch users never see it. */
@Composable
private fun Modifier.calendarFocusRing(source: MutableInteractionSource, shape: Shape): Modifier {
    val focused by source.collectIsFocusedAsState()
    return if (focused) this.border(BorderStroke(3.dp, WebInk), shape) else this
}

@Composable
private fun CalendarSourceBanner(failed: List<CalendarSourceStatus>, onRetry: () -> Unit) {
    Surface(
        color = MaterialTheme.colorScheme.errorContainer,
        contentColor = MaterialTheme.colorScheme.onErrorContainer,
        shape = RoundedCornerShape(12.dp),
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 8.dp)
            .semantics { liveRegion = LiveRegionMode.Polite },
    ) {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(playarrString(PlayarrString.CalendarSourceProblemsTitle), fontWeight = FontWeight.SemiBold, fontSize = 13.sp)
            failed.forEach { source ->
                val reason = playarrString(
                    when (source.status) {
                        "unreachable" -> PlayarrString.CalendarSourceUnreachable
                        "rejected" -> PlayarrString.CalendarSourceRejected
                        else -> PlayarrString.CalendarSourceError
                    },
                )
                val detail = source.error?.takeIf(String::isNotBlank)
                Text(
                    if (detail == null) {
                        playarrString(PlayarrString.CalendarSourceProblem, "name" to source.name, "reason" to reason)
                    } else {
                        playarrString(
                            PlayarrString.CalendarSourceProblemDetail,
                            "name" to source.name,
                            "reason" to reason,
                            "detail" to detail,
                        )
                    },
                    fontSize = 12.sp,
                )
            }
            PlayarrButton(variant = PlayarrButtonVariant.Ghost, onClick = onRetry) { Text(playarrString(PlayarrString.CalendarSourceRetry)) }
        }
    }
}

@Composable
private fun CalendarDayHeading(day: LocalDate, today: LocalDate, locale: Locale, isTelevision: Boolean) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        modifier = Modifier.padding(top = 10.dp).semantics { heading() },
    ) {
        Text(
            formatCalendarDay(day, locale),
            color = WebInk,
            fontSize = if (isTelevision) 20.sp else 16.sp,
            fontWeight = FontWeight.SemiBold,
        )
        if (day == today) {
            Surface(color = WebAccent.copy(alpha = 0.16f), shape = RoundedCornerShape(20.dp)) {
                Text(
                    playarrString(PlayarrString.CalendarToday).uppercase(locale),
                    color = WebAccent,
                    fontSize = 10.sp,
                    fontWeight = FontWeight.ExtraBold,
                    letterSpacing = 1.sp,
                    modifier = Modifier.padding(horizontal = 9.dp, vertical = 4.dp),
                )
            }
        }
    }
}

@Composable
private fun calendarEntryDetail(entry: CalendarEntry): String {
    val kind = CalendarMediaKind.fromWire(entry.mediaKind)
    return listOfNotNull(
        entry.episodeCode(),
        entry.subtitle?.takeIf(String::isNotBlank),
        if (kind == CalendarMediaKind.Movie || kind == CalendarMediaKind.Album || kind == CalendarMediaKind.Book) {
            calendarReleaseTypeLabel(entry.releaseType)
        } else {
            null
        },
    ).ifEmpty { listOf(kind?.let { calendarKindLabel(it) } ?: entry.mediaKind) }.joinToString(" · ")
}

@Composable
private fun CalendarPoster(url: String?, modifier: Modifier) {
    val shape = RoundedCornerShape(8.dp)
    if (url.isNullOrBlank()) {
        Box(modifier.background(WebSurfaceSoft, shape))
    } else {
        AsyncImage(
            model = url,
            contentDescription = null,
            contentScale = ContentScale.Crop,
            modifier = modifier.background(WebSurfaceSoft, shape),
        )
    }
}

@Composable
private fun CalendarDayCell(
    day: LocalDate,
    count: Int,
    inMonth: Boolean,
    isToday: Boolean,
    selected: Boolean,
    isTelevision: Boolean,
    locale: Locale,
    onClick: () -> Unit,
    modifier: Modifier,
) {
    val source = remember { MutableInteractionSource() }
    val shape = RoundedCornerShape(8.dp)
    val description = playarrString(
        PlayarrString.CalendarDayDescription,
        "date" to formatCalendarDay(day, locale),
        "count" to count,
    )
    Surface(
        onClick = onClick,
        color = if (selected) WebAccent.copy(alpha = 0.22f) else WebSurfaceSoft.copy(alpha = if (inMonth) 0.62f else 0.3f),
        shape = shape,
        border = if (isToday) BorderStroke(1.5.dp, WebAccent) else null,
        interactionSource = source,
        modifier = modifier
            .heightIn(min = if (isTelevision) 84.dp else 56.dp)
            .calendarFocusRing(source, shape)
            .semantics(mergeDescendants = true) { contentDescription = description },
    ) {
        Column(Modifier.padding(6.dp), verticalArrangement = Arrangement.SpaceBetween) {
            Text(
                day.dayOfMonth.toString(),
                color = if (inMonth) WebInk else WebInkMuted,
                fontWeight = if (isToday) FontWeight.ExtraBold else FontWeight.Medium,
                fontSize = if (isTelevision) 16.sp else 13.sp,
            )
            if (count > 0) {
                Surface(color = WebAccent.copy(alpha = 0.85f), shape = RoundedCornerShape(10.dp)) {
                    Text(
                        count.toString(),
                        color = Color.White,
                        fontSize = 10.sp,
                        fontWeight = FontWeight.Bold,
                        modifier = Modifier.padding(horizontal = 6.dp, vertical = 1.dp),
                    )
                }
            }
        }
    }
}

// ---- Subscription link ------------------------------------------------------

/** The one-time secret URL: warning, copy and share (phones) or a QR code (television). */
@Composable
private fun CalendarCreatedLink(url: String, isTelevision: Boolean) {
    val context = LocalContext.current
    var copied by remember(url) { mutableStateOf(false) }
    val label = playarrString(PlayarrString.CalendarSubscribeUrlLabel)
    val chooser = playarrString(PlayarrString.CalendarSubscribeShareChooser)
    Text(
        playarrString(PlayarrString.CalendarSubscribeUrlWarning),
        color = MaterialTheme.colorScheme.error,
        fontSize = 13.sp,
        fontWeight = FontWeight.SemiBold,
        modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
    )
    OutlinedTextField(
        value = url,
        onValueChange = {},
        readOnly = true,
        label = { Text(label) },
        modifier = Modifier.fillMaxWidth(),
    )
    PlayarrQrCode(value = url, contentDescription = playarrString(PlayarrString.CalendarSubscribeQrLabel), modifier = Modifier.size(if (isTelevision) 220.dp else 180.dp))
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        PlayarrButton(onClick = { copied = copyCalendarLink(context, label, url) }) {
            Text(playarrString(if (copied) PlayarrString.CalendarSubscribeCopied else PlayarrString.CalendarSubscribeCopy))
        }
        if (!isTelevision) {
            PlayarrButton(variant = PlayarrButtonVariant.Secondary, onClick = { shareCalendarLink(context, chooser, url) }) {
                Text(playarrString(PlayarrString.CalendarSubscribeShare))
            }
        }
    }
}

private fun copyCalendarLink(context: android.content.Context, label: String, url: String): Boolean {
    val clipboard = context.getSystemService(android.content.ClipboardManager::class.java) ?: return false
    val clip = android.content.ClipData.newPlainText(label, url)
    if (android.os.Build.VERSION.SDK_INT >= 33) {
        clip.description.extras = android.os.PersistableBundle().apply {
            putBoolean(android.content.ClipDescription.EXTRA_IS_SENSITIVE, true)
        }
    }
    clipboard.setPrimaryClip(clip)
    return true
}

private fun shareCalendarLink(context: android.content.Context, chooserTitle: String, url: String) {
    val send = android.content.Intent(android.content.Intent.ACTION_SEND)
        .setType("text/plain")
        .putExtra(android.content.Intent.EXTRA_TEXT, url)
    runCatching {
        context.startActivity(
            android.content.Intent.createChooser(send, chooserTitle)
                .addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK),
        )
    }
}

// ---- Availability lag (series detail) --------------------------------------

/**
 * "Usually available about X after release", an honest "no data yet" when the server has no
 * samples, and a subtle line for items it excluded (backfills and undated items).
 */
@Composable
internal fun PlayarrAvailabilityLagLine(lag: io.playarr.shared.data.model.AvailabilityLag, modifier: Modifier = Modifier, webTv: Boolean = false) {
    // Web shows nothing until there is an average (row 3.9922: no "No availability data yet" text).
    val average = lag.averageSeconds ?: return
    Column(modifier, verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Text(
            playarrString(PlayarrString.AvailabilityLagUsually, "duration" to calendarLagText(average)),
            color = if (webTv) WebInk else WebInkSoft,
            fontSize = if (webTv) 19.2.sp else 13.sp,
            lineHeight = if (webTv) 28.8.sp else androidx.compose.ui.unit.TextUnit.Unspecified,
            fontWeight = if (webTv) FontWeight(640) else FontWeight.Medium,
        )
        if (average != null && lag.sampleCount > 0) {
            Text(playarrString(PlayarrString.AvailabilityLagBasedOn, "count" to lag.sampleCount), color = WebInkMuted, fontSize = 11.sp)
        }
        if (lag.backfillCount > 0) {
            Text(playarrString(PlayarrString.AvailabilityLagBackfills, "count" to lag.backfillCount), color = WebInkMuted, fontSize = 11.sp)
        }
        if (lag.unknownCount > 0) {
            Text(playarrString(PlayarrString.AvailabilityLagUnknown, "count" to lag.unknownCount), color = WebInkMuted, fontSize = 11.sp)
        }
    }
}

/** Web `EntryPillTone`. */
internal enum class CalendarPillTone { Available, Upcoming, Missing, Neutral }

/** Web `entryPillTone`: a file means available, a later local day upcoming, otherwise missing when monitored. */
internal fun calendarEntryTone(entry: CalendarEntry, today: LocalDate, zone: ZoneId): CalendarPillTone = when {
    entry.hasFile -> CalendarPillTone.Available
    (entry.releaseAt?.atZone(zone)?.toLocalDate() ?: entry.date) > today -> CalendarPillTone.Upcoming
    entry.monitored -> CalendarPillTone.Missing
    else -> CalendarPillTone.Neutral
}

/** Web `itemPillTone`: a series group reports its worst state (missing, upcoming, neutral, then available). */
internal fun calendarItemTone(item: CalendarItem, today: LocalDate, zone: ZoneId): CalendarPillTone {
    val tones = when (item) {
        is CalendarItem.Series -> item.entries
        is CalendarItem.Single -> listOf(item.first)
    }.map { calendarEntryTone(it, today, zone) }
    return listOf(CalendarPillTone.Missing, CalendarPillTone.Upcoming, CalendarPillTone.Neutral).firstOrNull { it in tones } ?: CalendarPillTone.Available
}

internal val LocalCalendarToday = androidx.compose.runtime.compositionLocalOf { LocalDate.now() }

/** Web `.status-pill`: the tone at 60% as the border and 14% over the surface as the fill, ink text at weight 750. */
@Composable
private fun CalendarTonePill(tone: CalendarPillTone) {
    val dark = webIsDark
    val toneColour = when (tone) {
        CalendarPillTone.Available -> if (dark) Color(0xFF8AC5A5) else Color(0xFF224C3A)
        CalendarPillTone.Upcoming -> Color(0xFFCF3157)
        CalendarPillTone.Missing -> if (dark) Color(0xFFF1A4A8) else Color(0xFF722F34)
        CalendarPillTone.Neutral -> WebInkSoft
    }
    val label = playarrString(
        when (tone) {
            CalendarPillTone.Available -> PlayarrString.CalendarPillAvailable
            CalendarPillTone.Upcoming -> PlayarrString.CalendarStatusUpcoming
            CalendarPillTone.Missing -> PlayarrString.CalendarStatusMissing
            CalendarPillTone.Neutral -> PlayarrString.CalendarPillNotTracked
        },
    )
    Box(
        Modifier.background(androidx.compose.ui.graphics.lerp(WebSurface, toneColour, 0.14f), CircleShape)
            .border(1.dp, toneColour.copy(alpha = 0.6f), CircleShape)
            .padding(horizontal = 10.4.dp, vertical = 2.9.dp),
    ) {
        Text(label, color = WebInk, fontSize = 13.44.sp, lineHeight = 18.8.sp, fontWeight = FontWeight(750), style = WebTextStyle, maxLines = 1)
    }
}

/** Web `.calendar-today-badge`: the small outlined TODAY tag beside today's heading. */
@Composable
private fun CalendarTodayBadge() {
    Box(Modifier.border(1.dp, WebInkSoft.copy(alpha = 0.6f), CircleShape).padding(horizontal = 7.dp, vertical = 1.dp)) {
        Text(playarrString(PlayarrString.CalendarToday).uppercase(), color = WebInkSoft, fontSize = 9.6.sp, lineHeight = 14.sp, fontWeight = FontWeight(800), letterSpacing = 0.6.sp, style = WebTextStyle)
    }
}

/**
 * Web agenda `CalendarDetails` on the stage (`DetailsPanel`): the eyebrow in `--brand-ink`, the balanced 9ch title, the
 * subtitle and date in `--dp-soft`, the tone pill, the overview of a single release, then the actions.
 */
@Composable
private fun TvCalendarDetails(item: CalendarItem, locale: Locale, zone: ZoneId, today: LocalDate, onOpenWork: (String) -> Unit, onPlay: (String) -> Unit, actions: CalendarActionsHolder) {
    val entry = item.first
    val kind = CalendarMediaKind.fromWire(entry.mediaKind)
    val kindLabel = if (kind == CalendarMediaKind.Episode) playarrString(PlayarrString.CalendarDetailKindEpisode) else kind?.let { calendarKindLabel(it) } ?: entry.mediaKind
    val allDay = playarrString(PlayarrString.CalendarAllDay)
    val whenText = remember(entry.releaseAt, locale, zone, allDay) {
        entry.releaseAt?.let { playarrFullDateTime(it, zone, locale) } ?: "${formatCalendarDay(entry.date, locale)} · $allDay"
    }
    val palette = io.playarr.shared.designsystem.theme.PlayarrWebTheme.palette
    Column(Modifier.width(455.dp)) {
        Text(
            "$kindLabel · ${calendarReleaseTypeLabel(entry.releaseType)}".uppercase(locale), color = palette.brandInk,
            fontSize = 12.288.sp, lineHeight = 18.432.sp, fontWeight = FontWeight(860), letterSpacing = 0.983.sp, style = WebTextStyle,
        )
        WebHeroTitle(item.title, Modifier.padding(top = 25.9.dp), maxLines = 3)
        androidx.compose.foundation.layout.FlowRow(Modifier.padding(top = 27.dp), horizontalArrangement = Arrangement.spacedBy(12.8.dp)) {
            listOf(calendarItemSubtitle(item), whenText).filter(String::isNotBlank).forEach {
                Text(it, color = palette.detailsSoft, fontSize = 13.056.sp, lineHeight = 19.584.sp, fontWeight = FontWeight(600), style = WebTextStyle)
            }
        }
        Row(Modifier.padding(top = 17.dp)) { CalendarTonePill(calendarItemTone(item, today, zone)) }
        Spacer(Modifier.height(24.dp))
        CalendarDetailActions(item, onOpenWork, onPlay, actions)
    }
}

/** The agenda details' actions in web order: Play or Resume, Open, Request, Watchlist (server-computed). */
@OptIn(androidx.compose.foundation.layout.ExperimentalLayoutApi::class)
@Composable
private fun CalendarDetailActions(item: CalendarItem, onOpenWork: (String) -> Unit, onPlay: (String) -> Unit, actions: CalendarActionsHolder) {
    val entry = item.first
    val kind = CalendarMediaKind.fromWire(entry.mediaKind)
    val workId = entry.openWorkId
    val m = LocalCalendarMetrics.current
    Column {
            val holderState by actions.state.collectAsState()
            val snapshot = entry.snapshot
            val request = entry.action(io.playarr.shared.data.model.CalendarAction.REQUEST)
            val watchlist = entry.action(io.playarr.shared.data.model.CalendarAction.WATCHLIST)?.takeIf { it.enabled }
            androidx.compose.foundation.layout.FlowRow(horizontalArrangement = Arrangement.spacedBy(m.pillGap.dp), verticalArrangement = Arrangement.spacedBy(m.pillGap.dp)) {
                // Web `planCalendarActions`: resume, else play, when the server enabled it and named a file.
                val playable = listOf(entry.action(io.playarr.shared.data.model.CalendarAction.RESUME), entry.action(io.playarr.shared.data.model.CalendarAction.PLAY))
                    .firstOrNull { it?.enabled == true && !it.mediaFileId.isNullOrBlank() }
                if (playable != null) {
                    PhoneCalendarPill(
                        playarrString(if (playable.action == io.playarr.shared.data.model.CalendarAction.RESUME) PlayarrString.DiscoveryActionResume else PlayarrString.DiscoveryActionPlay),
                        primary = true,
                    ) { onPlay(playable.mediaFileId.orEmpty()) }
                }
                if (workId != null) {
                    val openSeries = item is CalendarItem.Series || kind == CalendarMediaKind.Episode
                    // Web: Open is the primary button unless Play is offered.
                PhoneCalendarPill(playarrString(if (openSeries) PlayarrString.CalendarOpenSeries else PlayarrString.CalendarOpen), primary = playable == null) { onOpenWork(workId) }
                }
                if (snapshot != null && request != null) {
                    val requested = request.active || snapshot in holderState.requested
                    PhoneCalendarPill(
                        playarrString(if (requested) PlayarrString.DiscoveryRequested else PlayarrString.DiscoveryActionRequest),
                        enabled = request.enabled && !requested && snapshot !in holderState.busy,
                    ) { actions.request(snapshot) }
                }
                if (snapshot != null && watchlist != null) {
                    val listed = holderState.listed[snapshot] ?: watchlist.active
                    PhoneCalendarPill(
                        playarrString(if (listed) PlayarrString.WatchlistRemove else PlayarrString.WatchlistAdd),
                        glyph = if (listed) "✓" else "+",
                        enabled = snapshot !in holderState.busy,
                    ) { actions.toggleWatchlist(snapshot, listed) }
                }
            }
            holderState.error?.let { Text(playarrText(it), color = MaterialTheme.colorScheme.error, fontSize = 12.sp) }
    }
}

/** Web `formatRangeButtonLabel`: "11 Oct – 9 Nov" for a span, "Oct 2026" for a month. */
internal fun calendarRangeLabelShort(mode: CalendarViewMode, anchor: LocalDate, window: CalendarWindow, locale: Locale): String {
    if (mode == CalendarViewMode.Month) return PlayarrDateFormat("yMMM", locale).format(anchor)
    val end = if (mode == CalendarViewMode.Agenda) window.end.minusDays(1) else window.end
    val day = PlayarrDateFormat("MMMd", locale)
    return "${day.format(window.start)} \u2013 ${day.format(end)}"
}
