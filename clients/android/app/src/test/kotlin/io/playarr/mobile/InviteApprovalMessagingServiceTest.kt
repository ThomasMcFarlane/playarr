package io.playarr.mobile

import io.playarr.shared.data.model.ClientPlatform
import org.junit.Assert.assertEquals
import org.junit.Test

class InviteApprovalMessagingServiceTest {
    @Test
    fun `push registration retains the token and reports the device family`() {
        assertEquals(
            ClientPlatform.AndroidMobile,
            playarrPushRegistration("phone-token", isTelevision = false).platform,
        )
        assertEquals(
            ClientPlatform.AndroidTv,
            playarrPushRegistration("tv-token", isTelevision = true).platform,
        )
        assertEquals(
            "tv-token",
            playarrPushRegistration("tv-token", isTelevision = true).token,
        )
    }
}
