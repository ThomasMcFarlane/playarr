package io.playarr.mobile.ui

import androidx.compose.ui.test.assertIsFocused
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import io.playarr.mobile.remote.RemotePairingRequest
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

/** The TV approval prompt must own D-pad focus as soon as it appears; run as an instrumented test. */
class PlayarrRemotePairingPromptUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val request = RemotePairingRequest(
        pairingId = "p1",
        controllerName = "Test Phone",
        verificationCode = "123456",
        scopes = listOf("navigate"),
    )

    @Test
    fun allowButtonTakesFocusWithoutAnyKeyPress() {
        compose.setContent {
            RemotePairingPromptContent(request, busy = false, onAllow = {}, onDeny = {})
        }
        compose.waitUntil(5_000) {
            runCatching { compose.onNodeWithTag("remote-pairing-allow").assertIsFocused() }.isSuccess
        }
    }

    @Test
    fun allowAndDenyInvokeTheirCallbacks() {
        var allowed = false
        var denied = false
        compose.setContent {
            RemotePairingPromptContent(request, busy = false, onAllow = { allowed = true }, onDeny = { denied = true })
        }
        compose.onNodeWithTag("remote-pairing-deny").performClick()
        compose.onNodeWithTag("remote-pairing-allow").performClick()
        assertTrue(allowed && denied)
    }
}
