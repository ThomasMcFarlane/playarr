package io.playarr.shared.designsystem.page

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** The header action order is enforced by [orderedForHeader], never trusted from the caller. */
class PlayarrPageActionsOrderTest {
    private val filters = PlayarrPageAction.Filters("Filters", open = false, activeCount = 0) {}
    private val link = PlayarrPageAction.Link("customise", "Customise", PlayarrActionIcon.Customise) {}
    private val panel = PlayarrPageAction.Panel("bell", "Calendar link", PlayarrActionIcon.Bell, open = false) {}
    private val status = PlayarrPageAction.Status("offline", "Offline")
    private val navigation = PlayarrPageAction.Navigation("period", emptyList())

    @Test
    fun filtersIsAlwaysLast() {
        val ordered = orderedForHeader(listOf(filters, link, panel))
        assertTrue(ordered.last() is PlayarrPageAction.Filters)
        assertEquals(listOf(link, panel, filters), ordered)
    }

    @Test
    fun navigationComesFirstAndSecondaryPillsKeepTheGivenOrder() {
        assertEquals(listOf(navigation, panel, link, status, filters), orderedForHeader(listOf(filters, panel, link, status, navigation)))
    }

    @Test
    fun legacySlotsFollowTheSameRanks() {
        val nav = PlayarrPageAction.LegacySlot("nav", LegacyPlacement.Navigation) {}
        val pills = PlayarrPageAction.LegacySlot("pills", LegacyPlacement.Panel) {}
        assertEquals(listOf(nav, pills, filters), orderedForHeader(listOf(filters, pills, nav)))
    }

    @Test(expected = IllegalArgumentException::class)
    fun atMostOneFilters() {
        orderedForHeader(listOf(filters, filters))
    }
}
