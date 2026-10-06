package io.playarr.mobile.ui

import io.playarr.shared.data.model.HouseholdApproval
import java.time.Instant
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import retrofit2.HttpException
import retrofit2.Response

class PlayarrGuardianApprovalsTest {
    private val now = Instant.parse("2026-10-03T12:00:00Z")
    private val self = "guardian"
    private val child = "child"

    private fun approval(
        id: String,
        profile: String = child,
        kind: String = "time",
        subject: String = "budget",
        status: String = "pending",
        requestedAt: String = "2026-10-03T11:00:00Z",
        expiresAt: String? = "2026-10-03T13:00:00Z",
    ) = HouseholdApproval(
        id = id,
        profileUserId = profile,
        kind = kind,
        subject = subject,
        status = status,
        requestedAt = requestedAt,
        requestExpiresAt = expiresAt,
    )

    private fun http(code: Int, body: String) =
        HttpException(Response.error<Any>(code, body.toResponseBody("application/json".toMediaType())))

    @Test
    fun onlyLivePendingRequestsFromGuardedProfilesAreListedNewestFirst() {
        val list = listOf(
            approval("old", requestedAt = "2026-10-03T10:00:00Z"),
            approval("new", requestedAt = "2026-10-03T11:30:00Z"),
            approval("decided", status = "approved"),
            approval("expired", expiresAt = "2026-10-03T11:59:00Z"),
            approval("own", profile = self),
            approval("stranger", profile = "someone-else"),
            approval("no-expiry", expiresAt = null, requestedAt = "2026-10-03T09:00:00Z"),
        )
        val visible = pendingGuardianApprovals(list, self, setOf(child), now)
        assertEquals(listOf("new", "old", "no-expiry"), visible.map { it.id })
    }

    @Test
    fun bonusMinutesAcceptOneToTheServerMaximum() {
        assertEquals(30, parseBonusMinutes("30"))
        assertEquals(1, parseBonusMinutes(" 1 "))
        assertEquals(240, parseBonusMinutes("240"))
        assertNull(parseBonusMinutes("0"))
        assertNull(parseBonusMinutes("241"))
        assertNull(parseBonusMinutes(""))
        assertNull(parseBonusMinutes("abc"))
        assertNull(parseBonusMinutes("-5"))
    }

    @Test
    fun decisionRequestsCarryThePinAndBonusOnlyForApprovedBudgetRequests() {
        val budget = approval("a")
        val approve = guardianDecisionRequest(budget, approve = true, pin = "1234", bonusMinutes = 45)
        assertEquals(true, approve.approve)
        assertEquals("1234", approve.pin)
        assertEquals(45, approve.bonusMinutes)

        val schedule = guardianDecisionRequest(approval("b", subject = "schedule"), true, "1234", 45)
        assertNull(schedule.bonusMinutes)

        val content = guardianDecisionRequest(approval("c", kind = "content", subject = "w"), true, "1234", 45)
        assertNull(content.bonusMinutes)

        val deny = guardianDecisionRequest(budget, approve = false, pin = "1234", bonusMinutes = 45)
        assertEquals(false, deny.approve)
        assertNull(deny.pin)
        assertNull(deny.bonusMinutes)
    }

    @Test
    fun serverFailuresMapToTheirOwnError() {
        assertEquals(
            GuardianDecisionError.WrongPin,
            guardianDecisionError(http(401, """{"error":"invalid_pin","message":"invalid profile PIN"}""")),
        )
        assertEquals(
            GuardianDecisionError.SelfApproval,
            guardianDecisionError(
                http(403, """{"error":"forbidden","message":"a profile cannot approve its own request"}"""),
            ),
        )
        assertEquals(
            GuardianDecisionError.NotAllowed,
            guardianDecisionError(http(403, """{"error":"forbidden","message":"not a guardian of this profile"}""")),
        )
        assertEquals(
            GuardianDecisionError.NoPin,
            guardianDecisionError(
                http(403, """{"error":"forbidden","message":"set a profile PIN before approving requests"}"""),
            ),
        )
        assertEquals(
            GuardianDecisionError.AlreadyDecided,
            guardianDecisionError(http(409, """{"error":"conflict","message":"approval already decided or expired"}""")),
        )
        assertEquals(
            GuardianDecisionError.PinLocked(90),
            guardianDecisionError(
                http(429, """{"error":"pin_locked","message":"m","details":{"retry_after_seconds":90}}"""),
            ),
        )
        assertEquals(GuardianDecisionError.NotFound, guardianDecisionError(http(404, "{}")))
        assertEquals(GuardianDecisionError.Failed, guardianDecisionError(http(500, "{}")))
        assertEquals(GuardianDecisionError.Failed, guardianDecisionError(IllegalStateException("offline")))
    }

    @Test
    fun specificForbiddenCodesWinOverTheMessageText() {
        // The code is authoritative: a reworded message must not change the outcome.
        assertEquals(
            GuardianDecisionError.SelfApproval,
            guardianDecisionError(http(403, """{"error":"self_approval_forbidden","message":"reworded"}""")),
        )
        assertEquals(
            GuardianDecisionError.NoPin,
            guardianDecisionError(http(403, """{"error":"guardian_pin_not_set","message":"reworded"}""")),
        )
        assertEquals(
            GuardianDecisionError.NotAllowed,
            guardianDecisionError(http(403, """{"error":"not_guardian","message":"a profile cannot approve its own request"}""")),
        )
    }

    @Test
    fun genericForbiddenFromOlderServersFallsBackToTheMessageText() {
        assertEquals(
            GuardianDecisionError.SelfApproval,
            guardianDecisionError(http(403, """{"error":"forbidden","message":"A profile cannot approve its own request"}""")),
        )
        assertEquals(
            GuardianDecisionError.NoPin,
            guardianDecisionError(http(403, """{"error":"forbidden","message":"set a profile PIN before approving requests"}""")),
        )
        assertEquals(
            GuardianDecisionError.NotAllowed,
            guardianDecisionError(http(403, """{"error":"forbidden","message":"a restricted profile cannot approve requests"}""")),
        )
        assertEquals(GuardianDecisionError.NotAllowed, guardianDecisionError(http(403, "{}")))
        assertNull(guardianForbiddenByCode("forbidden"))
        assertNull(guardianForbiddenByCode(null))
    }

    @Test
    fun aRecordedDecisionYieldsAConfirmationMessage() {
        assertEquals(
            PlayarrString.GuardianApprovedConfirmation,
            guardianConfirmation(approval("a").copy(status = "approved")),
        )
        assertEquals(
            PlayarrString.GuardianDeniedConfirmation,
            guardianConfirmation(approval("a").copy(status = "denied")),
        )
        assertNull(guardianConfirmation(approval("a").copy(status = "pending")))
    }

    @Test
    fun everyErrorHasALocalisedMessageAndLockoutsShowWholeMinutes() {
        assertEquals(
            PlayarrMessage.Localized(PlayarrString.GuardianWrongPin),
            guardianDecisionMessage(GuardianDecisionError.WrongPin),
        )
        assertEquals(
            PlayarrMessage.Localized(PlayarrString.GuardianSelfApproval),
            guardianDecisionMessage(GuardianDecisionError.SelfApproval),
        )
        assertEquals(
            PlayarrMessage.Localized(PlayarrString.GuardianAlreadyDecided),
            guardianDecisionMessage(GuardianDecisionError.AlreadyDecided),
        )
        assertEquals(
            PlayarrMessage.Localized(PlayarrString.ProfilesPinLocked, mapOf("minutes" to 2)),
            guardianDecisionMessage(GuardianDecisionError.PinLocked(90)),
        )
        assertEquals(
            PlayarrMessage.Localized(PlayarrString.ProfilesPinLocked, mapOf("minutes" to 1)),
            guardianDecisionMessage(GuardianDecisionError.PinLocked(1)),
        )
        listOf(
            GuardianDecisionError.NotAllowed,
            GuardianDecisionError.NoPin,
            GuardianDecisionError.NotFound,
            GuardianDecisionError.Failed,
        ).forEach { guardianDecisionMessage(it) }
    }

    @Test
    fun requestsAreDescribedByWhatTheChildAsksFor() {
        assertEquals(PlayarrString.GuardianSubjectBudget, guardianSubjectLabel(approval("a")))
        assertEquals(PlayarrString.GuardianSubjectSchedule, guardianSubjectLabel(approval("a", subject = "schedule")))
        assertEquals(PlayarrString.GuardianSubjectContent, guardianSubjectLabel(approval("a", kind = "content", subject = "w")))
        assertEquals(PlayarrString.GuardianSubjectOther, guardianSubjectLabel(approval("a", kind = "install", subject = "x")))
    }
}
