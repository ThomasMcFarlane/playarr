package io.playarr.mobile.ui

import java.net.URI
import org.junit.Assert.assertEquals
import org.junit.Test

class PlayarrLegalLinksTest {
    @Test
    fun `settings legal links use the public HTTPS routes`() {
        assertEquals("https://playarr.app/legal/privacy", PLAYARR_PRIVACY_URL)
        assertEquals("https://playarr.app/legal/account-deletion", PLAYARR_ACCOUNT_DELETION_URL)

        listOf(PLAYARR_PRIVACY_URL, PLAYARR_ACCOUNT_DELETION_URL).forEach { url ->
            val uri = URI(url)
            assertEquals("https", uri.scheme)
            assertEquals("playarr.app", uri.host)
        }
    }
}
