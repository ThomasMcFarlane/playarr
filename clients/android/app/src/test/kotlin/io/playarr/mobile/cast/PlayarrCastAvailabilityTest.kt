package io.playarr.mobile.cast

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PlayarrCastAvailabilityTest {
    @Test
    fun `offers cast when every condition is satisfied`() {
        assertTrue(
            shouldOfferPlayarrCast(
                isTelevision = false,
                playServicesAvailable = true,
                receiverAppIdConfigured = true,
                serverIsHttps = true,
            ),
        )
    }

    @Test
    fun `never offers cast on television`() {
        assertFalse(
            shouldOfferPlayarrCast(
                isTelevision = true,
                playServicesAvailable = true,
                receiverAppIdConfigured = true,
                serverIsHttps = true,
            ),
        )
    }

    @Test
    fun `withholds cast when Play services is unavailable`() {
        assertFalse(
            shouldOfferPlayarrCast(
                isTelevision = false,
                playServicesAvailable = false,
                receiverAppIdConfigured = true,
                serverIsHttps = true,
            ),
        )
    }

    @Test
    fun `withholds cast when no receiver app id is configured`() {
        assertFalse(
            shouldOfferPlayarrCast(
                isTelevision = false,
                playServicesAvailable = true,
                receiverAppIdConfigured = false,
                serverIsHttps = true,
            ),
        )
    }

    @Test
    fun `withholds cast for a plain HTTP server`() {
        assertFalse(
            shouldOfferPlayarrCast(
                isTelevision = false,
                playServicesAvailable = true,
                receiverAppIdConfigured = true,
                serverIsHttps = false,
            ),
        )
    }

    @Test
    fun `every condition failing at once still withholds cast`() {
        assertFalse(
            shouldOfferPlayarrCast(
                isTelevision = true,
                playServicesAvailable = false,
                receiverAppIdConfigured = false,
                serverIsHttps = false,
            ),
        )
    }
}
