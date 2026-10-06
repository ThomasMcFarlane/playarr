package io.playarr.mobile.ui

import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.performTextReplacement
import io.playarr.shared.data.model.HouseholdApproval
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

/** Compose UI tests for the guardian approval card; run as instrumented tests. */
class PlayarrGuardianApprovalsUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val request = HouseholdApproval(
        id = "a1",
        profileUserId = "child",
        kind = "time",
        subject = "budget",
        status = "pending",
        requestedAt = "2026-10-03T11:00:00Z",
    )

    @Test
    fun approveNeedsAFourDigitPinAndSendsPinAndBonus() {
        var decision: GuardianDecision? = null
        compose.setContent {
            GuardianApprovalCard(request, "Child", busy = false, error = null, onDecide = { decision = it })
        }
        compose.onNodeWithTag("guardian-approve").assertIsNotEnabled()
        compose.onNodeWithTag("guardian-pin").performTextInput("1234")
        compose.onNodeWithTag("guardian-bonus").performTextReplacement("45")
        compose.onNodeWithTag("guardian-approve").assertIsEnabled().performClick()
        assertEquals(GuardianDecision(approve = true, pin = "1234", bonusMinutes = 45), decision)
    }

    @Test
    fun anInvalidBonusKeepsApproveDisabled() {
        compose.setContent {
            GuardianApprovalCard(request, "Child", busy = false, error = null, onDecide = {})
        }
        compose.onNodeWithTag("guardian-pin").performTextInput("1234")
        compose.onNodeWithTag("guardian-bonus").performTextReplacement("999")
        compose.onNodeWithTag("guardian-approve").assertIsNotEnabled()
    }

    @Test
    fun denyNeedsNoPin() {
        var decision: GuardianDecision? = null
        compose.setContent {
            GuardianApprovalCard(request, "Child", busy = false, error = null, onDecide = { decision = it })
        }
        compose.onNodeWithTag("guardian-deny").assertIsEnabled().performClick()
        assertEquals(GuardianDecision(approve = false, pin = null, bonusMinutes = null), decision)
    }

    @Test
    fun errorsAreShownAndBusyDisablesBothActions() {
        compose.setContent {
            GuardianApprovalCard(
                request,
                "Child",
                busy = true,
                error = PlayarrMessage.Dynamic("The PIN was not accepted"),
                onDecide = {},
            )
        }
        compose.onNodeWithText("The PIN was not accepted").assertExists()
        compose.onNodeWithTag("guardian-deny").assertIsNotEnabled()
        compose.onNodeWithTag("guardian-approve").assertIsNotEnabled()
    }
}
