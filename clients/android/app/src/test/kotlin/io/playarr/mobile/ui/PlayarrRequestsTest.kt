package io.playarr.mobile.ui

import io.playarr.shared.data.model.RequestView
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class PlayarrRequestsTest {
    private fun view(mine: Boolean, by: String?) =
        RequestView(id = "1", title = "Orbit", status = "pending", mine = mine, requestedBy = by)

    @Test
    fun `statuses map to their labels and unknown statuses fall through`() {
        assertEquals("Waiting for approval", "pending".requestStatusLabel()?.english)
        assertEquals("Approved", "approved".requestStatusLabel()?.english)
        assertEquals("Declined", "declined".requestStatusLabel()?.english)
        assertEquals("Available", "available".requestStatusLabel()?.english)
        assertEquals("Failed", "failed".requestStatusLabel()?.english)
        assertNull("something-new".requestStatusLabel())
    }

    @Test
    fun `requester label prefers you, then the named requester, then nothing`() {
        assertEquals(PlayarrString.RequestsByYou, view(true, "sam").requesterLabel()?.first)
        val other = view(false, "kim").requesterLabel()
        assertEquals(PlayarrString.RequestsBy, other?.first)
        assertEquals(mapOf("name" to "kim"), other?.second)
        assertNull(view(false, null).requesterLabel())
    }
}
