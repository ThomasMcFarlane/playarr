package io.playarr.shared.data.remote

import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class HouseholdErrorsTest {
    private fun blocked(details: String) =
        """{"error":"household_blocked","message":"m","details":$details}"""

    @Test
    fun scheduleBlockCarriesTheNextStart() {
        val block = householdBlockOf(
            403,
            blocked("""{"reason":"outside_schedule","next_start_at":"2026-10-05T10:00:00Z"}"""),
        )
        assertEquals(HouseholdBlock.OutsideSchedule("2026-10-05T10:00:00Z"), block)
    }

    @Test
    fun budgetBlockCarriesTheReset() {
        val block = householdBlockOf(
            403,
            blocked("""{"reason":"budget_exhausted","resets_at":"2026-10-04T00:00:00Z"}"""),
        )
        assertEquals(HouseholdBlock.BudgetExhausted("2026-10-04T00:00:00Z"), block)
    }

    @Test
    fun contentReasonsAreReportedByCode() {
        assertEquals(
            HouseholdBlock.Content("rating_too_high"),
            householdBlockOf(403, blocked("""{"reason":"rating_too_high"}""")),
        )
    }

    @Test
    fun ordinaryForbiddenIsNotAHouseholdBlock() {
        assertNull(householdBlockOf(403, """{"error":"forbidden","message":"nope"}"""))
        assertNull(householdBlockOf(403, "not json"))
        assertNull(householdBlockOf(403, null))
        assertNull(householdBlockOf(401, blocked("""{"reason":"outside_schedule"}""")))
    }

    @Test
    fun pinLockSecondsComeFromTheServer() {
        val body = """{"error":"pin_locked","message":"m","details":{"retry_after_seconds":90}}"""
        assertEquals(90, pinLockSecondsOf(429, body))
        assertEquals(60, pinLockSecondsOf(429, """{"error":"pin_locked","message":"m"}"""))
        assertNull(pinLockSecondsOf(429, """{"error":"other"}"""))
        assertNull(pinLockSecondsOf(401, body))
    }

    @Test
    fun statusModelDecodesServerJsonWithUnknownFields() {
        val json = Json { ignoreUnknownKeys = true }
        val status = json.decodeFromString(
            io.playarr.shared.data.model.HouseholdStatus.serializer(),
            """{"restricted":true,"state":"allowed","remaining_seconds":1500,"server_time":"t","offline_valid_until":"u","guardian_for":["a"],"extra":1}""",
        )
        assertEquals(1500L, status.remainingSeconds)
        assertEquals(listOf("a"), status.guardianFor)
    }
}
