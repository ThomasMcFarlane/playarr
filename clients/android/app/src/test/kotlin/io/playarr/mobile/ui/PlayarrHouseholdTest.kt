package io.playarr.mobile.ui

import io.playarr.shared.data.model.HouseholdStatus
import java.time.Instant
import java.time.ZoneId
import java.util.Locale
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.Test
import retrofit2.HttpException
import retrofit2.Response

class PlayarrHouseholdTest {
    private val now = Instant.parse("2026-10-03T12:00:00Z")
    private val allowed = HouseholdStatus(restricted = true, state = "allowed")

    @Test
    fun onlyScheduleAndBudgetStatesBlock() {
        assertNull(householdBlockState(null))
        assertNull(householdBlockState(allowed))
        assertNull(householdBlockState(HouseholdStatus(state = "unrestricted")))
        assertEquals(
            HouseholdBlockState.OutsideSchedule("2026-10-04T07:00:00Z"),
            householdBlockState(HouseholdStatus(state = "outside_schedule", nextStartAt = "2026-10-04T07:00:00Z")),
        )
        val budget = householdBlockState(HouseholdStatus(state = "budget_exhausted", resetsAt = "r"))
        assertEquals(HouseholdBlockState.BudgetExhausted("r"), budget)
        assertEquals("budget", budget?.approvalSubject)
        assertEquals("schedule", HouseholdBlockState.OutsideSchedule(null).approvalSubject)
    }

    @Test
    fun remainingTimeWarnsInTheLastHourUsingTheNearerLimit() {
        assertNull(householdRemainingMinutes(allowed.copy(remainingSeconds = 7200), now))
        assertEquals(25, householdRemainingMinutes(allowed.copy(remainingSeconds = 1500), now))
        assertEquals(
            10,
            householdRemainingMinutes(
                allowed.copy(remainingSeconds = 3000, windowEndsAt = "2026-10-03T12:10:00Z"),
                now,
            ),
        )
        assertNull(householdRemainingMinutes(allowed, now))
        assertNull(householdRemainingMinutes(HouseholdStatus(state = "unrestricted"), now))
    }

    @Test
    fun instantsAreShownInTheDeviceZone() {
        val text = formatHouseholdInstant("2026-10-03T12:00:00Z", Locale.UK, ZoneId.of("Asia/Tokyo"))
        assertTrue(text, text!!.contains("21:00"))
        assertNull(formatHouseholdInstant(null, Locale.UK))
        assertNull(formatHouseholdInstant("not a date", Locale.UK))
    }

    private fun http(code: Int, body: String) =
        HttpException(Response.error<Any>(code, body.toResponseBody("application/json".toMediaType())))

    @Test
    fun pinFailuresExplainLockoutsAndSwitchingUp() {
        val locked = profilePinFailureMessage(
            http(429, """{"error":"pin_locked","message":"m","details":{"retry_after_seconds":90}}"""),
        )
        assertEquals(
            PlayarrMessage.Localized(PlayarrString.ProfilesPinLocked, mapOf("minutes" to 2)),
            locked,
        )
        assertEquals(
            PlayarrMessage.Localized(PlayarrString.ProfilesPinNotAccepted),
            profilePinFailureMessage(http(401, """{"error":"invalid_pin","message":"m"}""")),
        )
        assertEquals(
            PlayarrMessage.Localized(PlayarrString.ProfilesGuardianPinRequired),
            profilePinFailureMessage(http(403, """{"error":"guardian_pin_required","message":"m"}""")),
        )
        assertNull(profilePinFailureMessage(http(500, "{}")))
        assertNull(profilePinFailureMessage(IllegalStateException("offline")))
    }
}
