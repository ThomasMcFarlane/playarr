package io.playarr.mobile.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import io.playarr.shared.data.model.CalendarFeedCreated
import io.playarr.shared.data.model.CalendarFeedStatus
import io.playarr.shared.data.model.CalendarMediaKind
import io.playarr.shared.data.model.CalendarResponse
import io.playarr.shared.domain.model.PlayarrError
import io.playarr.shared.domain.model.PlayarrResult
import io.playarr.shared.domain.model.runCatchingPlayarr
import io.playarr.shared.domain.repository.CalendarRepository
import java.time.DayOfWeek
import java.time.LocalDate
import java.util.Locale
import javax.inject.Inject
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

internal sealed interface CalendarLoad {
    data object Loading : CalendarLoad
    data class Ready(val response: CalendarResponse) : CalendarLoad
    data class Failed(val message: PlayarrMessage) : CalendarLoad
}

internal data class CalendarUiState(
    val mode: CalendarViewMode,
    val anchor: LocalDate,
    val window: CalendarWindow,
    /** Type, source, status, range and monitored filters; empty means "everything". */
    val filters: CalendarFilters = CalendarFilters(),
    /** Day highlighted in the month grid, if any. */
    val selectedDay: LocalDate? = null,
    /** Selected entry id or group key (agenda master-detail, month/week sheet). */
    val selectedKey: String? = null,
    /** Open right-side panel. */
    val panel: CalendarPanel? = null,
    val load: CalendarLoad = CalendarLoad.Loading,
) {
    /** Empty means every media kind. */
    val kinds: Set<CalendarMediaKind> get() = filters.types.map { it.kind }.toSet()

    /** The URL-equivalent of this state, for saved-state restoration and deep links. */
    fun toUrlState(): CalendarUrlState =
        CalendarUrlState(mode, anchor, filters, selectedKey, panel)
}

private fun calendarFailure(error: PlayarrError): PlayarrMessage =
    error.userMessageForExperience(PlayarrString.ErrorSubjectCalendar)

/** Friendly calendar-link errors: unreachable server versus a server too old to offer links, never a raw exception. */
internal fun calendarLinkFailure(error: PlayarrError): PlayarrMessage = when {
    error is PlayarrError.Network -> PlayarrMessage.Localized(PlayarrString.CalendarLinkUnreachable)
    error is PlayarrError.Http && error.code in setOf(404, 405, 501) ->
        PlayarrMessage.Localized(PlayarrString.CalendarLinkUnsupported)
    else -> calendarFailure(error)
}

/** Calendar page state machine; scope-driven and free of Android types so it is unit-testable. */
internal class CalendarStateHolder(
    private val scope: CoroutineScope,
    private val repository: CalendarRepository,
    private val today: () -> LocalDate,
    private val firstDay: DayOfWeek,
    initialMode: CalendarViewMode = CalendarViewMode.Agenda,
    private val failureMessage: (PlayarrError) -> PlayarrMessage = ::calendarFailure,
    initialUrlState: CalendarUrlState? = null,
) {
    private val _state = MutableStateFlow(
        today().let { now ->
            val mode = initialUrlState?.view ?: initialMode
            val anchor = initialUrlState?.date?.let { anchorForMode(mode, it) }
                ?: initialUrlState?.filters?.from?.let { anchorForMode(mode, it) }
                ?: todayAnchor(mode, now)
            CalendarUiState(
                mode = mode,
                anchor = anchor,
                window = calendarWindow(mode, anchor, firstDay),
                filters = initialUrlState?.filters ?: CalendarFilters(),
                selectedKey = initialUrlState?.selected,
                panel = initialUrlState?.panel,
            )
        },
    )
    val state: StateFlow<CalendarUiState> = _state.asStateFlow()
    private var loadJob: Job? = null

    fun load() {
        val window = _state.value.window
        loadJob?.cancel()
        _state.update { it.copy(load = CalendarLoad.Loading) }
        loadJob = scope.launch {
            val result = runCatchingPlayarr { repository.calendar(window.start, window.end) }
            // A newer navigation replaced this window while the request was in flight.
            if (_state.value.window != window) return@launch
            _state.update {
                it.copy(
                    load = when (result) {
                        is PlayarrResult.Success -> CalendarLoad.Ready(result.value)
                        is PlayarrResult.Failure -> CalendarLoad.Failed(failureMessage(result.error))
                    },
                )
            }
        }
    }

    fun setMode(mode: CalendarViewMode) {
        val current = _state.value
        if (current.mode == mode) return
        // Keep the reader's place: a selected day (month grid) or today's page, else the current anchor.
        val base = current.selectedDay ?: today().takeIf { it in current.window } ?: current.anchor
        val anchor = anchorForMode(mode, base)
        navigate(current.copy(mode = mode, anchor = anchor, window = calendarWindow(mode, anchor, firstDay), selectedKey = null))
    }

    fun next() = move(1)

    fun previous() = move(-1)

    private fun move(direction: Int) {
        val current = _state.value
        val anchor = shiftCalendarAnchor(current.mode, current.anchor, direction)
        navigate(current.copy(anchor = anchor, window = calendarWindow(current.mode, anchor, firstDay), selectedDay = null))
    }

    fun goToToday() {
        val current = _state.value
        val now = today()
        val anchor = todayAnchor(current.mode, now)
        navigate(
            current.copy(
                anchor = anchor,
                window = calendarWindow(current.mode, anchor, firstDay),
                selectedDay = now.takeIf { current.mode == CalendarViewMode.Month },
            ),
        )
    }

    fun toggleKind(kind: CalendarMediaKind) {
        val type = CalendarType.fromKind(kind)
        _state.update {
            val types = if (type in it.filters.types) it.filters.types - type else it.filters.types + type
            it.copy(filters = it.filters.copy(types = types))
        }
    }

    fun clearKinds() {
        _state.update { it.copy(filters = it.filters.copy(types = emptySet())) }
    }

    fun setFilters(filters: CalendarFilters) {
        _state.update { it.copy(filters = filters) }
    }

    fun clearFilters() = setFilters(CalendarFilters())

    fun select(key: String?) {
        _state.update { it.copy(selectedKey = key) }
    }

    fun openPanel(panel: CalendarPanel?) {
        _state.update { it.copy(panel = panel) }
    }

    /** Jumps the page to [day] in [mode] (the "+N more" link and the date-range filter). */
    fun showDay(mode: CalendarViewMode, day: LocalDate) {
        val current = _state.value
        val anchor = anchorForMode(mode, day)
        navigate(
            current.copy(mode = mode, anchor = anchor, window = calendarWindow(mode, anchor, firstDay), selectedKey = null),
        )
    }

    fun selectDay(day: LocalDate?) {
        _state.update { it.copy(selectedDay = day) }
    }

    private fun navigate(next: CalendarUiState) {
        val reload = next.window != _state.value.window
        _state.value = next
        if (reload) load()
    }
}

internal data class CalendarSubscriptionState(
    val status: CalendarFeedStatus? = null,
    val loading: Boolean = true,
    val busy: Boolean = false,
    /** The only copy of the secret URL; cleared when the reader dismisses it. */
    val created: CalendarFeedCreated? = null,
    val error: PlayarrMessage? = null,
)

/** Subscription management; the secret URL lives only in [CalendarSubscriptionState.created]. */
internal class CalendarSubscriptionHolder(
    private val scope: CoroutineScope,
    private val repository: CalendarRepository,
    private val failureMessage: (PlayarrError) -> PlayarrMessage = ::calendarLinkFailure,
) {
    private val _state = MutableStateFlow(CalendarSubscriptionState())
    val state: StateFlow<CalendarSubscriptionState> = _state.asStateFlow()

    /** Opening the link panel: read the status and, when there is no link yet, create one straight away. */
    fun ensureLink() {
        refresh(createIfMissing = true)
    }

    fun refresh(createIfMissing: Boolean = false) {
        _state.update { it.copy(loading = true, error = null) }
        scope.launch {
            when (val result = runCatchingPlayarr { repository.feedStatus() }) {
                is PlayarrResult.Success -> {
                    _state.update { it.copy(status = result.value, loading = false) }
                    if (createIfMissing && !result.value.active) createOrRegenerate()
                }
                is PlayarrResult.Failure -> _state.update {
                    it.copy(loading = false, error = failureMessage(result.error))
                }
            }
        }
    }

    /** Creates the subscription, or regenerates it (the previous URL stops working). */
    fun createOrRegenerate() {
        if (_state.value.busy) return
        _state.update { it.copy(busy = true, error = null) }
        scope.launch {
            when (val result = runCatchingPlayarr { repository.createFeed() }) {
                is PlayarrResult.Success -> _state.update {
                    it.copy(
                        busy = false,
                        created = result.value,
                        status = CalendarFeedStatus(active = true, createdAt = result.value.createdAt, lastUsedAt = null),
                    )
                }
                is PlayarrResult.Failure -> _state.update { it.copy(busy = false, error = failureMessage(result.error)) }
            }
        }
    }

    fun revoke() {
        if (_state.value.busy) return
        _state.update { it.copy(busy = true, error = null) }
        scope.launch {
            when (val result = runCatchingPlayarr { repository.revokeFeed() }) {
                is PlayarrResult.Success -> _state.update {
                    it.copy(busy = false, created = null, status = CalendarFeedStatus(active = false))
                }
                is PlayarrResult.Failure -> _state.update { it.copy(busy = false, error = failureMessage(result.error)) }
            }
        }
    }

    fun dismissCreated() {
        _state.update { it.copy(created = null) }
    }

    fun clearError() {
        _state.update { it.copy(error = null) }
    }
}

@HiltViewModel
internal class CalendarViewModel @Inject constructor(
    repository: CalendarRepository,
    private val savedState: androidx.lifecycle.SavedStateHandle,
) : ViewModel() {
    val calendar = CalendarStateHolder(
        scope = viewModelScope,
        repository = repository,
        today = { LocalDate.now() },
        firstDay = firstDayOfWeek(Locale.getDefault()),
        initialUrlState = savedState.get<String>(QUERY_KEY)?.let(::parseCalendarQuery),
    )
    val subscription = CalendarSubscriptionHolder(viewModelScope, repository)

    init {
        calendar.load()
        // Persist the URL-equivalent state so process death restores view, date, filters, selection and panel.
        viewModelScope.launch {
            calendar.state.collect { savedState[QUERY_KEY] = it.toUrlState().toQuery() }
        }
    }

    private companion object {
        const val QUERY_KEY = "calendarQuery"
    }
}
