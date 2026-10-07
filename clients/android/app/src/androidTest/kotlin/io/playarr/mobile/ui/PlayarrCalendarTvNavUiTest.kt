package io.playarr.mobile.ui

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.semantics.SemanticsNode
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assert
import androidx.compose.ui.test.assertIsFocused
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.isFocused
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performKeyInput
import androidx.compose.ui.test.pressKey
import androidx.compose.ui.test.requestFocus
import androidx.compose.ui.unit.dp
import io.playarr.shared.data.model.CalendarAction
import io.playarr.shared.data.model.CalendarEntry
import io.playarr.shared.data.model.CalendarResponse
import io.playarr.shared.domain.repository.CalendarRepository
import java.time.LocalDate
import java.time.ZoneOffset
import java.util.Locale
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

/** D-pad key sequences on the calendar views: week, month and agenda, scroll-into-view, fades and the availability border. */
class PlayarrCalendarTvNavUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val monday = LocalDate.parse("2026-10-05")
    private val zone = ZoneOffset.UTC

    private fun entry(day: LocalDate, n: Int, hasFile: Boolean = false) = CalendarEntry(
        id = "e-$day-$n", mediaKind = "movie", releaseType = "digital", title = "Film $day #$n",
        date = day, hasFile = hasFile,
        actions = if (hasFile) listOf(CalendarAction(CalendarAction.PLAY, enabled = true, mediaFileId = "f")) else emptyList(),
    )

    private fun week(counts: List<Int>, fileOn: Set<String> = emptySet()) = counts.mapIndexed { i, count ->
        val day = monday.plusDays(i.toLong())
        CalendarDayGroup(day, List(count) { entry(day, it, "$day#$it" in fileOn) })
    }

    private fun title(day: Int, n: Int) = "Film ${monday.plusDays(day.toLong())} #$n"

    private fun press(key: Key) = compose.onRoot().performKeyInput { pressKey(key) }

    private fun press(keys: List<Key>) = keys.forEach { press(it) }

    private fun setWeek(groups: List<CalendarDayGroup>, height: Int = 900) = compose.setContent {
        Box(Modifier.fillMaxWidth().height(height.dp)) {
            CalendarWeek(groups, loading = false, isTelevision = true, today = monday, zone = zone, locale = Locale.ENGLISH, selectedKey = null, onSelect = {}, modifier = Modifier.fillMaxWidth().height(height.dp))
        }
    }

    @Test
    fun weekLeftRightMovesBetweenDaysAndUpDownBetweenEntries() {
        setWeek(week(listOf(2, 0, 3, 1, 0, 0, 0)))
        compose.onNodeWithText(title(0, 0), substring = true).requestFocus()
        press(Key.DirectionDown)
        compose.onNodeWithText(title(0, 1), substring = true).assertIsFocused()
        press(Key.DirectionRight) // the empty day is skipped; same row
        compose.onNodeWithText(title(2, 1), substring = true).assertIsFocused()
        press(Key.DirectionUp)
        compose.onNodeWithText(title(2, 0), substring = true).assertIsFocused()
        press(Key.DirectionRight)
        compose.onNodeWithText(title(3, 0), substring = true).assertIsFocused()
        press(listOf(Key.DirectionLeft, Key.DirectionLeft))
        compose.onNodeWithText(title(0, 0), substring = true).assertIsFocused()
    }

    @Test
    fun weekFocusedEntryScrollsIntoViewAndTheBottomEdgeFades() {
        setWeek(week(listOf(12, 1, 0, 0, 0, 0, 0)), height = 420)
        compose.onNodeWithText(title(0, 0), substring = true).requestFocus()
        fun fades(match: (CalendarEdges) -> Boolean) =
            compose.onAllNodes(SemanticsMatcher("edges") { node: SemanticsNode -> node.config.getOrNull(CalendarEdgesKey)?.let(match) == true })
                .fetchSemanticsNodes().size
        assertTrue("bottom fade while content continues", fades { it.bottom } >= 1)
        repeat(11) { press(Key.DirectionDown) }
        compose.waitForIdle()
        compose.onNodeWithText(title(0, 11), substring = true).assertIsFocused().assertIsDisplayed()
        assertTrue("top fade once scrolled", fades { it.top } >= 1)
        assertTrue("the track continues sideways", fades { it.end } >= 1)
    }

    @Test
    fun weekBorderShowsAvailabilityNotLibrary() {
        val have = "${monday}#0"
        setWeek(week(listOf(2, 0, 0, 0, 0, 0, 0), fileOn = setOf(have)))
        compose.onNodeWithText(title(0, 0), substring = true)
            .assert(SemanticsMatcher.expectValue(CalendarAvailabilityKey, "available"))
        compose.onNodeWithText(title(0, 1), substring = true)
            .assert(SemanticsMatcher.expectValue(CalendarAvailabilityKey, "unavailable"))
    }

    @Test
    fun monthChipsMoveByCellAndSlotAndMoreOpensTheDay() {
        val window = calendarWindow(CalendarViewMode.Month, LocalDate.parse("2026-10-01"), java.time.DayOfWeek.MONDAY)
        fun day(d: Int) = LocalDate.parse("2026-10-%02d".format(d))
        val entries = listOf(
            entry(day(13), 0), entry(day(13), 1), entry(day(14), 0),
            entry(day(15), 0), entry(day(15), 1), entry(day(15), 2),
            entry(day(21), 0),
        ) + List(9) { entry(day(16), it) }
        var more: LocalDate? = null
        compose.setContent {
            val state = CalendarUiState(CalendarViewMode.Month, LocalDate.parse("2026-10-01"), window)
            CalendarMonth(state, entries, loading = false, isTelevision = true, today = monday, zone = zone, locale = Locale.ENGLISH,
                onSelectDay = {}, onSelect = {}, modifier = Modifier.fillMaxWidth().height(900.dp), onMore = { more = it })
        }
        // The test window is about 540 dp tall, so each cell fits one chip and then "+N more".
        fun chip(d: Int, n: Int) = compose.onNodeWithText("Film ${day(d)} #$n", substring = true)
        val moreFocused = hasText("more", substring = true) and isFocused()
        chip(13, 0).requestFocus()
        press(Key.DirectionRight)
        chip(14, 0).assertIsFocused()
        press(Key.DirectionLeft)
        chip(13, 0).assertIsFocused()
        press(Key.DirectionDown)
        compose.onNode(moreFocused).assertExists()
        press(Key.DirectionRight) // slot clamps to the neighbour's last stop
        chip(14, 0).assertIsFocused()
        // Down from a cell's last stop reaches the next populated cell in the column.
        press(Key.DirectionDown)
        chip(21, 0).assertIsFocused()
        press(Key.DirectionUp)
        chip(14, 0).assertIsFocused()
        press(listOf(Key.DirectionRight, Key.DirectionDown))
        compose.onNode(moreFocused).assertExists()
        press(Key.DirectionCenter)
        compose.waitForIdle()
        assertEquals(day(15), more)
    }

    @Test
    fun agendaDetailsFollowFocusWithoutSelect() {
        val days = (0 until 6).map { d -> CalendarDayGroup(monday.plusDays(d.toLong()), List(3) { entry(monday.plusDays(d.toLong()), it) }) }
        val repo = object : CalendarRepository {
            override suspend fun calendar(start: LocalDate, end: LocalDate) = CalendarResponse(start, end)
            override suspend fun feedStatus() = io.playarr.shared.data.model.CalendarFeedStatus(active = false)
            override suspend fun requestTitle(snapshot: io.playarr.shared.data.model.TitleSnapshot) = Unit
            override suspend fun setWatchlisted(snapshot: io.playarr.shared.data.model.TitleSnapshot, listed: Boolean) = Unit
            override suspend fun createFeed(rotate: Boolean): io.playarr.shared.data.model.CalendarFeedCreated = error("unused")
            override suspend fun revokeFeed() = Unit
            override suspend fun availabilityLag(workId: String) = io.playarr.shared.data.model.AvailabilityLag()
        }
        val holder = CalendarActionsHolder(CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate), repo)
        var selected by androidx.compose.runtime.mutableStateOf<String?>(null)
        val all = days.flatMap { it.entries }
        compose.setContent {
            val window = CalendarWindow(monday, monday.plusDays(30))
            val state = CalendarUiState(CalendarViewMode.Agenda, monday, window)
            val item = all.firstOrNull { it.id == selected }?.let { CalendarItem.Single(it) }
            TvCalendarAgenda(state, days, loading = false, selected = item, zone = zone, locale = Locale.ENGLISH,
                onSelect = { selected = it.key }, onOpenWork = {}, onPlay = {}, actions = holder, onJump = {})
        }
        compose.onNodeWithText(title(0, 0), substring = true).requestFocus()
        assertEquals("e-$monday-0", selected)
        press(Key.DirectionDown)
        assertEquals("e-$monday-1", selected)
        // Walk far enough that the list must scroll; the focused entry stays on screen and the selection follows.
        repeat(12) { press(Key.DirectionDown) }
        compose.waitForIdle()
        assertEquals("e-${monday.plusDays(4)}-1", selected)
        compose.onNode(hasText(title(4, 1), substring = true) and isFocused()).assertIsDisplayed()
        press(Key.DirectionUp)
        assertEquals("e-${monday.plusDays(4)}-0", selected)
        assertTrue(compose.onAllNodes(SemanticsMatcher("bottom fade") { it.config.getOrNull(CalendarEdgesKey)?.bottom == true }).fetchSemanticsNodes().isNotEmpty())
        assertTrue(compose.onAllNodes(SemanticsMatcher("top fade") { it.config.getOrNull(CalendarEdgesKey)?.top == true }).fetchSemanticsNodes().isNotEmpty())
    }
}
