package io.playarr.mobile.ui

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

@Composable
internal fun ExperienceCalendarScreen(
    isTelevision: Boolean,
    onBack: () -> Unit,
    onOpenWork: (String) -> Unit,
    onPlay: (String) -> Unit = {},
    viewModel: CalendarViewModel = hiltViewModel(),
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
    val today = remember { LocalDate.now() }
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
    val panelActions: @Composable RowScope.() -> Unit = {
            PlayarrHeaderButton(
                label = playarrString(PlayarrString.CalendarLinkTitle),
                icon = PlayarrWebIcons.Bell,
                isTelevision = isTelevision,
                active = state.panel == CalendarPanel.Subscription,
                onClick = { holder.openPanel(CalendarPanel.Subscription) },
            )
    }
    val phonePanelActions: @Composable RowScope.() -> Unit = {
        // Web phone: the subscription bell is an icon-only pill beside Filters.
        PlayarrPhoneHeaderPill(
            onClick = { holder.openPanel(CalendarPanel.Subscription) },
            contentDescription = playarrString(PlayarrString.CalendarLinkTitle),
            width = 44.dp,
            active = state.panel == CalendarPanel.Subscription,
        ) { Icon(PlayarrWebIcons.Bell, contentDescription = null, modifier = Modifier.size(12.4.dp)) }
    }
    val navigation: @Composable RowScope.() -> Unit = {
        TvCalendarRound("\u2190", playarrString(PlayarrString.CalendarPrevious), holder::previous)
        TvCalendarToday(playarrString(PlayarrString.CalendarToday), holder::goToToday)
        TvCalendarRound("\u2192", playarrString(PlayarrString.CalendarNext), holder::next)
    }
    PlayarrPageScaffold(
        title = playarrString(PlayarrString.CalendarTitle),
        onBack = onBack,
        isTelevision = isTelevision,
        filters = PlayarrFilterAction(
            label = filtersLabel,
            active = state.panel == CalendarPanel.Filters,
            badge = state.filters.activeCount,
            onClick = { holder.openPanel(CalendarPanel.Filters) },
        ),
        padBody = !(isTelevision && state.mode == CalendarViewMode.Agenda),
        panelActions = if (isTelevision) panelActions else phonePanelActions,
        // Phones are too narrow for five header actions beside the back button and title: the period
        // navigation moves into the period row below the header there.
        trailingNav = if (isTelevision) navigation else null,
    ) {
        if (!isTelevision) {
            PhoneCalendarHeader(state, language.locale, holder) { jumpOpen = true }
        } else if (state.mode != CalendarViewMode.Agenda) {
            CalendarPeriodLabel(state, isTelevision, language.locale) { jumpOpen = true }
        }
        when (val load = state.load) {
            is CalendarLoad.Failed -> Box(Modifier.weight(1f).fillMaxWidth(), contentAlignment = Alignment.Center) {
                Column(
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(14.dp),
                    modifier = Modifier.padding(32.dp),
                ) {
                    Text(playarrText(load.message), color = MaterialTheme.colorScheme.error, textAlign = TextAlign.Center)
                    PlayarrButton(onClick = holder::load) { Text(playarrString(PlayarrString.CommonTryAgain)) }
                }
            }
            else -> {
                if (ready != null) {
                    val failed = failedCalendarSources(ready.sources)
                    if (failed.isNotEmpty()) CalendarSourceBanner(failed, onRetry = holder::load)
                }
                val empty = !loading && items.isEmpty()
                if (empty) {
                    Box(Modifier.weight(1f).fillMaxWidth()) {
                        ExperienceEmpty(
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
                            state = state, groups = groups, loading = loading, selected = detailItem, zone = zone, locale = language.locale,
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
    19.4f, 23f, 8f, 15f, 58f, 15f, 22f, 19f, 10f, 100f, 20f, 28f, 13f, 19f, 40f to 60f, 14f, 18.7f, 28f,
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
    val sources = (item as? CalendarItem.Series)?.entries?.flatMap { it.sources } ?: entry.sources
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
        if (sources.isNotEmpty()) {
            Spacer(Modifier.height(m.factGap.dp))
            PhoneCalendarFact(playarrString(PlayarrString.CalendarSheetSources)) {
                Text(
                    androidx.compose.ui.text.buildAnnotatedString {
                        sources.distinctBy { it.sourceInstanceId to it.arrId }.forEachIndexed { index, source ->
                            if (index > 0) append(", ")
                            append(source.sourceName)
                            append(" ")
                            withStyle(androidx.compose.ui.text.SpanStyle(color = WebInkMuted)) { append("(${source.sourceKind})") }
                        }
                    },
                    color = WebInk, fontSize = m.body.sp, lineHeight = m.bodyLine.sp, style = WebTextStyle, modifier = if (m === TvCalendarMetrics) Modifier else Modifier.offset(y = 1.33.dp),
                )
            }
        }
        Spacer(Modifier.height(m.beforeActions.dp))
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
                PhoneCalendarPill(playarrString(if (openSeries) PlayarrString.CalendarOpenSeries else PlayarrString.CalendarOpen)) { onOpenWork(workId) }
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
private fun PhoneCalendarEntry(item: CalendarItem, selected: Boolean, zone: ZoneId, onClick: () -> Unit) {
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
        onClick = onClick,
        modifier = Modifier.padding(start = if (m === TvCalendarMetrics) 0.dp else 4.dp, end = if (m === TvCalendarMetrics) 0.dp else 8.dp).fillMaxWidth().height(m.entryHeight.dp).then(
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
                    PhoneCalendarBadge(calendarStateLabel(state), m.entryMeta.sp, m.entryMetaLine.sp)
                }
            }
        }
    }
}

@Composable
private fun TvCalendarRound(glyph: String, description: String, onClick: () -> Unit) {
    androidx.compose.material3.Surface(
        onClick = onClick, shape = CircleShape, color = WebSurface, contentColor = WebInkSoft,
        border = BorderStroke(1.dp, WebPillBorder),
        modifier = Modifier.size(50.dp).semantics { contentDescription = description },
    ) { Box(contentAlignment = Alignment.Center) { Text(glyph, fontSize = 13.sp, fontWeight = FontWeight(720)) } }
}

/** Web TV: Today holds the autofocus ring on entry, drawn 1.055x with a heavy ink ring. */
@Composable
private fun TvCalendarToday(label: String, onClick: () -> Unit) {
    val ring = WebInk
    androidx.compose.material3.Surface(
        onClick = onClick,
        modifier = Modifier.size(92.dp, 50.dp)
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
        shape = CircleShape, color = WebSurface, contentColor = WebInkSoft, border = BorderStroke(1.dp, WebPillBorder),
    ) { Box(contentAlignment = Alignment.Center) { Text(label, fontSize = 14.4.sp, fontWeight = FontWeight(720)) } }
}

/** Web TV agenda: the period label, the selected release's details at the left and the day list at the right. */
@Composable
private fun TvCalendarAgenda(
    state: CalendarUiState,
    groups: List<CalendarDayGroup>,
    loading: Boolean,
    selected: CalendarItem?,
    zone: ZoneId,
    locale: Locale,
    onSelect: (CalendarItem) -> Unit,
    onOpenWork: (String) -> Unit,
    onPlay: (String) -> Unit,
    actions: CalendarActionsHolder,
    onJump: () -> Unit,
) {
    androidx.compose.runtime.CompositionLocalProvider(LocalCalendarMetrics provides TvCalendarMetrics) {
        Box(Modifier.fillMaxSize()) {
            val title = remember(state.window, state.mode, state.anchor, locale) { phoneCalendarRangeTitle(state.mode, state.anchor, state.window, locale) }
            Row(
                Modifier.offset(x = 154.dp, y = 165.dp).height(56.dp).clip(CircleShape).clickable(onClick = onJump).padding(horizontal = 21.dp),
                verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                Text(
                    title, color = WebInk, fontSize = 24.sp, lineHeight = 36.sp, fontWeight = FontWeight(560), style = WebTextStyle, maxLines = 1,
                    modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
                )
                val ink = WebInk
                androidx.compose.foundation.Canvas(Modifier.size(width = 9.dp, height = 8.dp)) {
                    val path = androidx.compose.ui.graphics.Path().apply { moveTo(0f, 0f); lineTo(size.width, 0f); lineTo(size.width / 2f, size.height); close() }
                    drawPath(path, ink)
                }
            }
            Column(Modifier.offset(x = 154.dp, y = 236.dp).width(600.dp)) {
                when {
                    loading -> CalendarDetailSkeleton()
                    selected != null -> PhoneCalendarDetails(selected, locale, zone, onOpenWork, onPlay, actions)
                    else -> Text(playarrString(PlayarrString.CalendarSelectPrompt), color = WebInkMuted)
                }
            }
            val today = remember { LocalDate.now() }
            LazyColumn(Modifier.offset(x = 786.dp, y = 240.dp).width(1049.dp).fillMaxHeight()) {
                if (loading) {
                    items(3) { Column(Modifier.padding(vertical = 4.dp)) { PlayarrSkeleton(Modifier.width(180.dp).height(18.dp)); Spacer(Modifier.height(8.dp)); CalendarRowSkeleton() } }
                } else {
                    groups.forEach { group ->
                        item(key = "day-${group.date}") {
                            Text(
                                phoneCalendarDayHeading(group.date, locale), color = WebInk, fontSize = 18.7.sp, lineHeight = 28.sp, fontWeight = FontWeight(560),
                                style = WebTextStyle, modifier = Modifier.padding(bottom = 6.dp).semantics { heading() },
                            )
                        }
                        items(groupSeriesEpisodes(group.entries, zone), key = { "${group.date}-${it.key}" }) { item ->
                            PhoneCalendarEntry(item, selected = item.key == selected?.key, zone = zone, onClick = { onSelect(item) })
                            Spacer(Modifier.height(10.dp))
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
                CircularProgressIndicator(color = WebPink, modifier = Modifier.size(20.dp))
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

/** Week: wide day columns on a horizontally scrolling track (D-pad left/right moves between days). */
@Composable
private fun CalendarWeek(
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
    val days = remember(groups) { groups }
    val skeletonDays = remember(days) { if (days.isEmpty()) 7 else days.size }
    LazyRow(modifier, horizontalArrangement = Arrangement.spacedBy(20.dp), contentPadding = PaddingValues(end = 24.dp)) {
        if (loading) {
            items(skeletonDays) { index ->
                Column(Modifier.width(columnWidth), verticalArrangement = Arrangement.spacedBy(CalendarRowSpacing)) {
                    PlayarrSkeleton(Modifier.width(160.dp).height(18.dp))
                    repeat(1 + index % 2) { CalendarRowSkeleton() }
                }
            }
        } else {
            items(days, key = { "week-${it.date}" }) { group ->
                LazyColumn(
                    Modifier.width(columnWidth).fillMaxHeight(),
                    contentPadding = PaddingValues(bottom = 24.dp),
                    verticalArrangement = Arrangement.spacedBy(CalendarRowSpacing),
                ) {
                    item { CalendarDayHeading(group.date, today, locale, isTelevision) }
                    if (group.entries.isEmpty()) {
                        item { Text(playarrString(PlayarrString.CalendarEmptyDay), color = WebInkMuted, fontSize = 12.sp) }
                    } else {
                        items(groupSeriesEpisodes(group.entries, zone), key = { it.key }) { item ->
                            CalendarItemRow(item, selected = item.key == selectedKey, isTelevision = isTelevision, zone = zone, wrapTitle = true, onClick = { onSelect(item) })
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
        onClick = onClick,
        color = if (selected) WebPink.copy(alpha = 0.18f) else WebSurfaceSoft.copy(alpha = 0.62f),
        shape = shape,
        border = if (selected) BorderStroke(1.5.dp, WebInk) else null,
        interactionSource = source,
        modifier = Modifier
            .fillMaxWidth()
            .heightIn(min = 72.dp)
            .calendarFocusRing(source, shape)
            .semantics(mergeDescendants = true) { contentDescription = description },
    ) {
        Row(Modifier.padding(10.dp), verticalAlignment = Alignment.CenterVertically) {
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
            Text(calendarStateLabel(entry.libraryState()), color = WebPink, fontWeight = FontWeight.SemiBold, fontSize = 14.sp)
        }
        entry.averageLagSeconds?.takeIf { it > 0 }?.let {
            Text(
                playarrString(PlayarrString.AvailabilityLagUsually, "duration" to calendarLagText(it)),
                color = WebInkMuted,
                fontSize = 12.sp,
            )
        }
        val sources = (item as? CalendarItem.Series)?.entries?.flatMap { it.sources } ?: entry.sources
        if (sources.isNotEmpty()) {
            Text(playarrString(PlayarrString.CalendarSourcesHeading), color = WebInk, fontWeight = FontWeight.SemiBold, modifier = Modifier.semantics { heading() })
            sources.distinctBy { it.sourceInstanceId to it.arrId }.forEach {
                Text("${it.sourceName} · ${it.sourceKind}", color = WebInkSoft, fontSize = 13.sp)
            }
        }
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
private fun CalendarMonth(
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
) {
    val counts = remember(entries) { calendarEntryCountsByDay(entries, emptySet()) }
    val rows = remember(state.window) { calendarGridRows(state.window) }
    val firstDay = remember(locale) { firstDayOfWeek(locale) }
    val selected = state.selectedDay
    val dayItems = remember(entries, selected) {
        selected?.let { day -> groupSeriesEpisodes(entries.filter { it.date == day }.sortedBy { it.releaseAt }, zone) }.orEmpty()
    }
    BoxWithConstraints(modifier) {
        val wide = isTelevision || maxWidth >= 840.dp
        val grid: @Composable (Modifier) -> Unit = { gridModifier ->
            Column(gridModifier, verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Row(Modifier.fillMaxWidth()) {
                    calendarWeekdayLabels(firstDay, locale).forEach { label ->
                        Text(label, color = WebInkMuted, fontSize = 11.sp, textAlign = TextAlign.Center, modifier = Modifier.weight(1f))
                    }
                }
                rows.forEach { week ->
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                        week.forEach { day ->
                            CalendarDayCell(
                                day = day,
                                count = if (loading) 0 else counts[day] ?: 0,
                                inMonth = day.month == state.anchor.month,
                                isToday = day == today,
                                selected = day == selected,
                                isTelevision = isTelevision,
                                locale = locale,
                                onClick = { onSelectDay(day) },
                                modifier = Modifier.weight(1f),
                            )
                        }
                    }
                }
            }
        }
        val dayList: LazyListScope.() -> Unit = {
            if (selected != null) {
                item(key = "month-day-heading") { CalendarDayHeading(selected, today, locale, isTelevision) }
                items(dayItems, key = { it.key }) { item ->
                    CalendarItemRow(item, selected = item.key == state.selectedKey, isTelevision = isTelevision, zone = zone, onClick = { onSelect(item) })
                }
            }
        }
        if (wide) {
            Row(Modifier.fillMaxSize().padding(top = 8.dp), horizontalArrangement = Arrangement.spacedBy(24.dp)) {
                grid(Modifier.weight(1.4f).verticalScroll(rememberScrollState()))
                LazyColumn(Modifier.weight(1f).fillMaxSize(), contentPadding = PaddingValues(bottom = 24.dp), verticalArrangement = Arrangement.spacedBy(CalendarRowSpacing)) { dayList() }
            }
        } else {
            LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 24.dp, top = 8.dp), verticalArrangement = Arrangement.spacedBy(CalendarRowSpacing)) {
                item(key = "month-grid") { grid(Modifier.fillMaxWidth()) }
                dayList()
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

/** Visible focus indicator for D-pad users; touch users never see it. */
@Composable
private fun Modifier.calendarFocusRing(source: MutableInteractionSource, shape: Shape): Modifier {
    val focused by source.collectIsFocusedAsState()
    return if (focused) this.border(BorderStroke(3.dp, WebPink), shape) else this
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
            Surface(color = WebPink.copy(alpha = 0.16f), shape = RoundedCornerShape(20.dp)) {
                Text(
                    playarrString(PlayarrString.CalendarToday).uppercase(locale),
                    color = WebPink,
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
        color = if (selected) WebPink.copy(alpha = 0.22f) else WebSurfaceSoft.copy(alpha = if (inMonth) 0.62f else 0.3f),
        shape = shape,
        border = if (isToday) BorderStroke(1.5.dp, WebPink) else null,
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
                Surface(color = WebPink.copy(alpha = 0.85f), shape = RoundedCornerShape(10.dp)) {
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
    Column(modifier, verticalArrangement = Arrangement.spacedBy(2.dp)) {
        val average = lag.averageSeconds
        Text(
            if (average != null) {
                playarrString(PlayarrString.AvailabilityLagUsually, "duration" to calendarLagText(average))
            } else {
                playarrString(PlayarrString.AvailabilityLagNone)
            },
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
