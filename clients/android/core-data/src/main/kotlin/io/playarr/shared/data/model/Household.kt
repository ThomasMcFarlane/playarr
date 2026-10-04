package io.playarr.shared.data.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * The signed-in profile's household state (`GET /api/v1/household/status`).
 * [state] is `unrestricted`, `allowed`, `outside_schedule` or
 * `budget_exhausted`; the server decides, this only mirrors it.
 */
@Serializable
data class HouseholdStatus(
    val restricted: Boolean = false,
    val state: String = "unrestricted",
    @SerialName("remaining_seconds") val remainingSeconds: Long? = null,
    @SerialName("window_ends_at") val windowEndsAt: String? = null,
    @SerialName("next_start_at") val nextStartAt: String? = null,
    @SerialName("resets_at") val resetsAt: String? = null,
    @SerialName("daily_budget_minutes") val dailyBudgetMinutes: Int? = null,
    val timezone: String? = null,
    @SerialName("max_rating") val maxRating: String? = null,
    @SerialName("server_time") val serverTime: String = "",
    @SerialName("offline_valid_until") val offlineValidUntil: String = "",
    @SerialName("guardian_for") val guardianFor: List<String> = emptyList(),
)

@Serializable
data class HouseholdApproval(
    val id: String,
    @SerialName("profile_user_id") val profileUserId: String,
    val kind: String,
    val subject: String,
    val note: String? = null,
    val status: String,
    @SerialName("requested_at") val requestedAt: String = "",
    @SerialName("grant_expires_at") val grantExpiresAt: String? = null,
)

@Serializable
data class CreateHouseholdApprovalRequest(
    val kind: String,
    val subject: String,
    val note: String? = null,
)

@Serializable
data class DecideHouseholdApprovalRequest(
    val approve: Boolean,
    val pin: String? = null,
)
