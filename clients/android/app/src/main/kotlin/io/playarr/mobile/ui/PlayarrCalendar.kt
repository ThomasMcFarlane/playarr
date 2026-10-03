package io.playarr.mobile.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsFocusedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
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
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
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

@Composable
internal fun ExperienceCalendarScreen(
    isTelevision: Boolean,
    onOpenWork: (String) -> Unit,
    viewModel: CalendarViewModel = hiltViewModel(),
) {
    val state by viewModel.calendar.state.collectAsState()
    val language = LocalPlayarrLanguage.current
    val today = remember { LocalDate.now() }
    var detailEntry by remember { mutableStateOf<CalendarEntry?>(null) }
    var subscriptionOpen by remember { mutableStateOf(false) }
    val openEntry: (CalendarEntry) -> Unit = { entry ->
        val workId = entry.workId
        if (workId.isNullOrBlank()) detailEntry = entry else onOpenWork(workId)
    }
    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(WebSurface)
            .windowInsetsPadding(WindowInsets.safeDrawing)
            .padding(
                start = if (isTelevision) 72.dp else 16.dp,
                end = if (isTelevision) 72.dp else 16.dp,
                top = if (isTelevision) 40.dp else 24.dp,
            ),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                playarrString(PlayarrString.CalendarTitle),
                color = WebInk,
                fontSize = if (isTelevision) 44.sp else 30.sp,
                fontWeight = FontWeight.Medium,
                letterSpacing = (-1).sp,
                modifier = Modifier.weight(1f).semantics { heading() },
            )
            TextButton(onClick = { subscriptionOpen = true }) {
                Text(playarrString(PlayarrString.CalendarSubscribe), color = WebPink, fontWeight = FontWeight.SemiBold)
            }
        }
        CalendarControls(
            state = state,
            isTelevision = isTelevision,
            locale = language.locale,
            onPrevious = viewModel.calendar::previous,
            onNext = viewModel.calendar::next,
            onToday = viewModel.calendar::goToToday,
            onMode = viewModel.calendar::setMode,
            onToggleKind = viewModel.calendar::toggleKind,
            onClearKinds = viewModel.calendar::clearKinds,
        )
        when (val load = state.load) {
            CalendarLoad.Loading -> Box(Modifier.weight(1f).fillMaxWidth(), contentAlignment = Alignment.Center) {
                Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    CircularProgressIndicator(color = WebPink)
                    Text(playarrString(PlayarrString.CalendarLoading), color = WebInkMuted, fontSize = 12.sp)
                }
            }
            is CalendarLoad.Failed -> Box(Modifier.weight(1f).fillMaxWidth(), contentAlignment = Alignment.Center) {
                Column(
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(14.dp),
                    modifier = Modifier.padding(32.dp),
                ) {
                    Text(playarrText(load.message), color = MaterialTheme.colorScheme.error, textAlign = TextAlign.Center)
                    Button(onClick = viewModel.calendar::load) { Text(playarrString(PlayarrString.CommonTryAgain)) }
                }
            }
            is CalendarLoad.Ready -> {
                val failed = failedCalendarSources(load.response.sources)
                if (failed.isNotEmpty()) {
                    CalendarSourceBanner(failed, onRetry = viewModel.calendar::load)
                }
                CalendarBody(
                    state = state,
                    entries = load.response.entries,
                    isTelevision = isTelevision,
                    today = today,
                    locale = language.locale,
                    onSelectDay = viewModel.calendar::selectDay,
                    onOpen = openEntry,
                    modifier = Modifier.weight(1f).fillMaxWidth(),
                )
            }
        }
    }
    detailEntry?.let { entry ->
        CalendarEntryDetails(entry, isTelevision, language.locale) { detailEntry = null }
    }
    if (subscriptionOpen) {
        CalendarSubscriptionDialog(
            holder = viewModel.subscription,
            isTelevision = isTelevision,
            locale = language.locale,
            onDismiss = {
                viewModel.subscription.dismissCreated()
                subscriptionOpen = false
            },
        )
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
private fun calendarLagText(seconds: Long): String {
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
private fun CalendarControls(
    state: CalendarUiState,
    isTelevision: Boolean,
    locale: Locale,
    onPrevious: () -> Unit,
    onNext: () -> Unit,
    onToday: () -> Unit,
    onMode: (CalendarViewMode) -> Unit,
    onToggleKind: (CalendarMediaKind) -> Unit,
    onClearKinds: () -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onPrevious) {
                Icon(
                    Icons.AutoMirrored.Outlined.KeyboardArrowLeft,
                    contentDescription = playarrString(PlayarrString.CalendarPrevious),
                    tint = WebInk,
                )
            }
            TextButton(onClick = onToday) {
                Text(playarrString(PlayarrString.CalendarToday), color = WebPink, fontWeight = FontWeight.SemiBold)
            }
            IconButton(onClick = onNext) {
                Icon(
                    Icons.AutoMirrored.Outlined.KeyboardArrowRight,
                    contentDescription = playarrString(PlayarrString.CalendarNext),
                    tint = WebInk,
                )
            }
            Text(
                calendarWindowTitle(state.mode, state.anchor, state.window, locale),
                color = WebInk,
                fontSize = if (isTelevision) 22.sp else 16.sp,
                fontWeight = FontWeight.SemiBold,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f).padding(start = 8.dp).semantics { liveRegion = LiveRegionMode.Polite },
            )
        }
        val viewLabel = playarrString(PlayarrString.CalendarViewSwitcher)
        val filterLabel = playarrString(PlayarrString.CalendarFilterLabel)
        LazyRow(
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalAlignment = Alignment.CenterVertically,
            modifier = Modifier.fillMaxWidth().semantics { contentDescription = viewLabel },
        ) {
            items(CalendarViewMode.entries.toList(), key = { "mode-${it.name}" }) { mode ->
                CalendarChip(calendarModeLabel(mode), selected = state.mode == mode) { onMode(mode) }
            }
        }
        LazyRow(
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalAlignment = Alignment.CenterVertically,
            modifier = Modifier.fillMaxWidth().semantics { contentDescription = filterLabel },
        ) {
            item(key = "kind-all") {
                CalendarChip(playarrString(PlayarrString.CalendarKindAll), selected = state.kinds.isEmpty(), onClick = onClearKinds)
            }
            items(CalendarMediaKind.entries.toList(), key = { "kind-${it.name}" }) { kind ->
                CalendarChip(calendarKindLabel(kind), selected = kind in state.kinds) { onToggleKind(kind) }
            }
        }
    }
}

@Composable
private fun CalendarChip(label: String, selected: Boolean, onClick: () -> Unit) {
    val source = remember { MutableInteractionSource() }
    FilterChip(
        selected = selected,
        onClick = onClick,
        label = { Text(label) },
        interactionSource = source,
        colors = FilterChipDefaults.filterChipColors(
            labelColor = WebInk,
            selectedContainerColor = WebPink.copy(alpha = 0.22f),
            selectedLabelColor = WebInk,
        ),
        modifier = Modifier.calendarFocusRing(source, RoundedCornerShape(8.dp)),
    )
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
            TextButton(onClick = onRetry) { Text(playarrString(PlayarrString.CalendarSourceRetry)) }
        }
    }
}

@Composable
private fun CalendarBody(
    state: CalendarUiState,
    entries: List<CalendarEntry>,
    isTelevision: Boolean,
    today: LocalDate,
    locale: Locale,
    onSelectDay: (LocalDate?) -> Unit,
    onOpen: (CalendarEntry) -> Unit,
    modifier: Modifier = Modifier,
) {
    when (state.mode) {
        CalendarViewMode.Month -> CalendarMonth(state, entries, isTelevision, today, locale, onSelectDay, onOpen, modifier)
        else -> {
            val groups = remember(entries, state.kinds, state.window, state.mode) {
                groupCalendarEntries(entries, state.kinds, state.window, fillEmptyDays = state.mode == CalendarViewMode.Week)
            }
            if (groups.all { it.entries.isEmpty() }) {
                Box(modifier) {
                    ExperienceEmpty(
                        playarrString(PlayarrString.CalendarEmptyTitle),
                        playarrString(PlayarrString.CalendarEmptyDescription),
                    )
                }
            } else {
                LazyColumn(
                    modifier = modifier,
                    contentPadding = PaddingValues(bottom = 104.dp, top = 8.dp),
                    verticalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    groups.forEach { group -> calendarDaySection(group, isTelevision, today, locale, onOpen) }
                }
            }
        }
    }
}

private fun LazyListScope.calendarDaySection(
    group: CalendarDayGroup,
    isTelevision: Boolean,
    today: LocalDate,
    locale: Locale,
    onOpen: (CalendarEntry) -> Unit,
) {
    item(key = "day-${group.date}") {
        CalendarDayHeading(group.date, today, locale, isTelevision)
    }
    if (group.entries.isEmpty()) {
        item(key = "empty-${group.date}") {
            Text(playarrString(PlayarrString.CalendarEmptyDay), color = WebInkMuted, fontSize = 12.sp)
        }
    } else {
        items(group.entries, key = { "${group.date}-${it.id}" }) { entry ->
            CalendarEntryRow(entry, isTelevision, onClick = { onOpen(entry) })
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
private fun CalendarEntryRow(entry: CalendarEntry, isTelevision: Boolean, onClick: () -> Unit) {
    val source = remember { MutableInteractionSource() }
    val shape = RoundedCornerShape(12.dp)
    val stateLabel = calendarStateLabel(entry.libraryState())
    val detail = calendarEntryDetail(entry)
    val description = playarrString(
        PlayarrString.CalendarEntryDescription,
        "title" to entry.title,
        "detail" to detail,
        "state" to stateLabel,
    )
    Surface(
        onClick = onClick,
        color = WebSurfaceSoft.copy(alpha = 0.62f),
        shape = shape,
        interactionSource = source,
        modifier = Modifier
            .fillMaxWidth()
            .heightIn(min = 72.dp)
            .calendarFocusRing(source, shape)
            .semantics(mergeDescendants = true) { contentDescription = description },
    ) {
        Row(Modifier.padding(10.dp), verticalAlignment = Alignment.CenterVertically) {
            CalendarPoster(entry.posterUrl, Modifier.size(width = 44.dp, height = 64.dp))
            Column(Modifier.weight(1f).padding(horizontal = 12.dp)) {
                Text(
                    entry.title,
                    color = WebInk,
                    fontWeight = FontWeight.SemiBold,
                    fontSize = if (isTelevision) 18.sp else 15.sp,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Text(detail, color = WebInkSoft, fontSize = if (isTelevision) 14.sp else 12.sp, maxLines = 2, overflow = TextOverflow.Ellipsis)
                Text(stateLabel, color = WebInkMuted, fontSize = if (isTelevision) 13.sp else 11.sp)
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
private fun CalendarMonth(
    state: CalendarUiState,
    entries: List<CalendarEntry>,
    isTelevision: Boolean,
    today: LocalDate,
    locale: Locale,
    onSelectDay: (LocalDate?) -> Unit,
    onOpen: (CalendarEntry) -> Unit,
    modifier: Modifier,
) {
    val counts = remember(entries, state.kinds) { calendarEntryCountsByDay(entries, state.kinds) }
    val rows = remember(state.window) { calendarGridRows(state.window) }
    val firstDay = remember(locale) { firstDayOfWeek(locale) }
    val selected = state.selectedDay
    val dayGroup = remember(entries, state.kinds, selected) {
        selected?.let { day ->
            groupCalendarEntries(entries, state.kinds, CalendarWindow(day, day), fillEmptyDays = true)
                .firstOrNull { it.date == day }
        }
    }
    BoxWithConstraints(modifier) {
        val wide = isTelevision || maxWidth >= 840.dp
        val grid: @Composable (Modifier) -> Unit = { gridModifier ->
            Column(gridModifier, verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Row(Modifier.fillMaxWidth()) {
                    calendarWeekdayLabels(firstDay, locale).forEach { label ->
                        Text(
                            label,
                            color = WebInkMuted,
                            fontSize = 11.sp,
                            textAlign = TextAlign.Center,
                            modifier = Modifier.weight(1f),
                        )
                    }
                }
                rows.forEach { week ->
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                        week.forEach { day ->
                            CalendarDayCell(
                                day = day,
                                count = counts[day] ?: 0,
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
            if (selected != null && dayGroup != null) calendarDaySection(dayGroup, isTelevision, today, locale, onOpen)
        }
        if (wide) {
            Row(Modifier.fillMaxSize().padding(top = 8.dp), horizontalArrangement = Arrangement.spacedBy(24.dp)) {
                grid(Modifier.weight(1.4f).verticalScroll(rememberScrollState()))
                LazyColumn(
                    modifier = Modifier.weight(1f).fillMaxSize(),
                    contentPadding = PaddingValues(bottom = 104.dp),
                    verticalArrangement = Arrangement.spacedBy(10.dp),
                ) { dayList() }
            }
        } else {
            LazyColumn(
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(bottom = 104.dp, top = 8.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                item(key = "month-grid") { grid(Modifier.fillMaxWidth()) }
                dayList()
            }
        }
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

// ---- Entry details ---------------------------------------------------------

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun CalendarEntryDetails(entry: CalendarEntry, isTelevision: Boolean, locale: Locale, onDismiss: () -> Unit) {
    if (isTelevision) {
        val focus = remember { FocusRequester() }
        AlertDialog(
            onDismissRequest = onDismiss,
            title = { Text(entry.title) },
            text = {
                Box(Modifier.heightIn(max = 420.dp).verticalScroll(rememberScrollState())) {
                    CalendarEntryDetailsContent(entry, locale)
                }
            },
            confirmButton = {
                TextButton(onClick = onDismiss, modifier = Modifier.focusRequester(focus)) {
                    Text(playarrString(PlayarrString.CommonClose))
                }
            },
        )
        LaunchedEffect(Unit) { runCatching { focus.requestFocus() } }
    } else {
        ModalBottomSheet(onDismissRequest = onDismiss, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)) {
            Column(Modifier.padding(horizontal = 20.dp).padding(bottom = 32.dp).verticalScroll(rememberScrollState())) {
                Text(entry.title, color = WebInk, fontSize = 22.sp, fontWeight = FontWeight.SemiBold)
                Spacer(Modifier.height(10.dp))
                CalendarEntryDetailsContent(entry, locale)
                TextButton(onClick = onDismiss, modifier = Modifier.align(Alignment.End)) {
                    Text(playarrString(PlayarrString.CommonClose))
                }
            }
        }
    }
}

@Composable
private fun CalendarEntryDetailsContent(entry: CalendarEntry, locale: Locale) {
    val zone = remember { ZoneId.systemDefault() }
    val time = remember(entry.releaseAt, locale) { entry.localReleaseTime(zone, locale) }
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            CalendarPoster(entry.posterUrl, Modifier.size(width = 72.dp, height = 106.dp))
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(calendarEntryDetail(entry), color = WebInkSoft, fontSize = 14.sp)
                Text(
                    time?.let { playarrString(PlayarrString.CalendarReleasesAt, "time" to it) }
                        ?: "${formatCalendarDay(entry.date, locale)} · ${playarrString(PlayarrString.CalendarAllDay)}",
                    color = WebInk,
                    fontSize = 14.sp,
                )
                Text(calendarStateLabel(entry.libraryState()), color = WebPink, fontWeight = FontWeight.SemiBold, fontSize = 14.sp)
                entry.averageLagSeconds?.takeIf { it > 0 }?.let {
                    Text(
                        playarrString(PlayarrString.AvailabilityLagUsually, "duration" to calendarLagText(it)),
                        color = WebInkMuted,
                        fontSize = 12.sp,
                    )
                }
            }
        }
        Text(playarrString(PlayarrString.CalendarNotInCatalogue), color = WebInkMuted, fontSize = 12.sp)
        if (entry.sources.isNotEmpty()) {
            Text(
                playarrString(PlayarrString.CalendarSourcesHeading),
                color = WebInk,
                fontWeight = FontWeight.SemiBold,
                modifier = Modifier.semantics { heading() },
            )
            entry.sources.forEach { source ->
                Text("${source.sourceName} · ${source.sourceKind}", color = WebInkSoft, fontSize = 13.sp)
            }
        }
    }
}

// ---- Subscription ----------------------------------------------------------

private enum class SubscriptionConfirm { Regenerate, Revoke }

@Composable
private fun CalendarSubscriptionDialog(
    holder: CalendarSubscriptionHolder,
    isTelevision: Boolean,
    locale: Locale,
    onDismiss: () -> Unit,
) {
    val state by holder.state.collectAsState()
    var confirm by remember { mutableStateOf<SubscriptionConfirm?>(null) }
    LaunchedEffect(Unit) { holder.refresh() }
    val formatter = remember(locale) {
        DateTimeFormatter.ofLocalizedDateTime(FormatStyle.MEDIUM, FormatStyle.SHORT).withLocale(locale).withZone(ZoneId.systemDefault())
    }
    fun format(instant: Instant?): String? = instant?.let(formatter::format)
    val created = state.created
    AlertDialog(
        onDismissRequest = onDismiss,
        title = {
            Text(playarrString(if (created != null) PlayarrString.CalendarSubscribeUrlTitle else PlayarrString.CalendarSubscribeTitle))
        },
        text = {
            Column(
                Modifier.fillMaxWidth().heightIn(max = 520.dp).verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                if (created != null) {
                    CalendarCreatedLink(created.url, isTelevision)
                } else {
                    Text(playarrString(PlayarrString.CalendarSubscribeDescription), color = WebInkMuted, fontSize = 13.sp)
                    when {
                        state.loading -> CircularProgressIndicator(color = WebPink)
                        state.status?.active == true -> {
                            Text(playarrString(PlayarrString.CalendarSubscribeActive), color = WebInk, fontWeight = FontWeight.SemiBold)
                            format(state.status?.createdAt)?.let {
                                Text(playarrString(PlayarrString.CalendarSubscribeCreated, "date" to it), color = WebInkMuted, fontSize = 12.sp)
                            }
                            Text(
                                format(state.status?.lastUsedAt)
                                    ?.let { playarrString(PlayarrString.CalendarSubscribeLastUsed, "date" to it) }
                                    ?: playarrString(PlayarrString.CalendarSubscribeNeverUsed),
                                color = WebInkMuted,
                                fontSize = 12.sp,
                            )
                        }
                        state.status != null -> Text(playarrString(PlayarrString.CalendarSubscribeInactive), color = WebInkMuted)
                    }
                    if (!state.loading && state.status != null) {
                        val active = state.status?.active == true
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            Button(
                                enabled = !state.busy,
                                onClick = { if (active) confirm = SubscriptionConfirm.Regenerate else holder.createOrRegenerate() },
                            ) {
                                Text(playarrString(if (active) PlayarrString.CalendarSubscribeRegenerate else PlayarrString.CalendarSubscribeCreate))
                            }
                            if (active) {
                                OutlinedButton(enabled = !state.busy, onClick = { confirm = SubscriptionConfirm.Revoke }) {
                                    Text(playarrString(PlayarrString.CalendarSubscribeRevoke))
                                }
                            }
                        }
                    }
                }
                state.error?.let {
                    Text(playarrText(it), color = MaterialTheme.colorScheme.error, fontSize = 13.sp)
                    if (state.status == null) TextButton(onClick = holder::refresh) { Text(playarrString(PlayarrString.CommonTryAgain)) }
                }
            }
        },
        confirmButton = {
            TextButton(onClick = onDismiss) { Text(playarrString(PlayarrString.CommonDone)) }
        },
    )
    confirm?.let { pending ->
        val regenerate = pending == SubscriptionConfirm.Regenerate
        AlertDialog(
            onDismissRequest = { confirm = null },
            title = {
                Text(playarrString(if (regenerate) PlayarrString.CalendarSubscribeRegenerateTitle else PlayarrString.CalendarSubscribeRevokeTitle))
            },
            text = {
                Text(playarrString(if (regenerate) PlayarrString.CalendarSubscribeRegenerateBody else PlayarrString.CalendarSubscribeRevokeBody))
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        confirm = null
                        if (regenerate) holder.createOrRegenerate() else holder.revoke()
                    },
                ) {
                    Text(playarrString(if (regenerate) PlayarrString.CalendarSubscribeRegenerate else PlayarrString.CalendarSubscribeRevoke))
                }
            },
            dismissButton = {
                TextButton(onClick = { confirm = null }) { Text(playarrString(PlayarrString.CommonCancel)) }
            },
        )
    }
}

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
    if (isTelevision) {
        PlayarrQrCode(value = url, contentDescription = label, modifier = Modifier.size(220.dp))
    }
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Button(onClick = { copied = copyCalendarLink(context, label, url) }) {
            Text(playarrString(if (copied) PlayarrString.CalendarSubscribeCopied else PlayarrString.CalendarSubscribeCopy))
        }
        if (!isTelevision) {
            OutlinedButton(onClick = { shareCalendarLink(context, chooser, url) }) {
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
internal fun PlayarrAvailabilityLagLine(lag: io.playarr.shared.data.model.AvailabilityLag, modifier: Modifier = Modifier) {
    Column(modifier, verticalArrangement = Arrangement.spacedBy(2.dp)) {
        val average = lag.averageSeconds
        Text(
            if (average != null) {
                playarrString(PlayarrString.AvailabilityLagUsually, "duration" to calendarLagText(average))
            } else {
                playarrString(PlayarrString.AvailabilityLagNone)
            },
            color = WebInkSoft,
            fontSize = 13.sp,
            fontWeight = FontWeight.Medium,
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
