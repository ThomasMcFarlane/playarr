package io.playarr.mobile.ui

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class PlayarrDisplayPreferencesTest {
    @Test
    fun `home view defaults to thumbnails unless cover was explicitly persisted`() {
        assertEquals(PlayarrHomeViewPreference.Thumbnail, parsePlayarrHomeViewPreference(null))
        assertEquals(PlayarrHomeViewPreference.Thumbnail, parsePlayarrHomeViewPreference(""))
        assertEquals(PlayarrHomeViewPreference.Thumbnail, parsePlayarrHomeViewPreference("thumbnail"))
        assertEquals(PlayarrHomeViewPreference.Thumbnail, parsePlayarrHomeViewPreference("Cover"))
        assertEquals(PlayarrHomeViewPreference.Cover, parsePlayarrHomeViewPreference("cover"))
    }

    @Test
    fun `only cover requires a persisted home view value`() {
        assertNull(PlayarrHomeViewPreference.Thumbnail.persistedValue())
        assertEquals("cover", PlayarrHomeViewPreference.Cover.persistedValue())
    }
}
