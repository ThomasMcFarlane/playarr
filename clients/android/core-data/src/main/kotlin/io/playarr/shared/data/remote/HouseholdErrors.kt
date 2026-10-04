package io.playarr.shared.data.remote

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import retrofit2.HttpException

/** Why the server refused a request for household/child-control reasons. */
sealed interface HouseholdBlock {
    /** Outside the allowed schedule; [nextStartAt] is an ISO instant when known. */
    data class OutsideSchedule(val nextStartAt: String?) : HouseholdBlock

    /** Today's watch time is used up; [resetsAt] is an ISO instant when known. */
    data class BudgetExhausted(val resetsAt: String?) : HouseholdBlock

    /** Rating, unrated, tag or folder rule; [reason] is the server's code. */
    data class Content(val reason: String) : HouseholdBlock
}

/** The parts of the server's `{error, message, details}` body clients use. */
data class ApiErrorBody(
    val error: String,
    val message: String?,
    val details: JsonObject?,
)

private val lenientJson = Json { ignoreUnknownKeys = true }

/** Parses a server error body, or `null` when it is empty or not the expected shape. */
fun parseApiErrorBody(body: String?): ApiErrorBody? {
    if (body.isNullOrBlank()) return null
    return runCatching {
        val obj = lenientJson.parseToJsonElement(body).jsonObject
        ApiErrorBody(
            error = obj["error"]?.jsonPrimitive?.contentOrNull ?: return null,
            message = obj["message"]?.jsonPrimitive?.contentOrNull,
            details = runCatching { obj["details"]?.jsonObject }.getOrNull(),
        )
    }.getOrNull()
}

/** The household block carried by a `403 household_blocked` body, else `null`. */
fun householdBlockOf(status: Int, body: String?): HouseholdBlock? {
    if (status != 403) return null
    val parsed = parseApiErrorBody(body) ?: return null
    if (parsed.error != "household_blocked") return null
    val details = parsed.details
    return when (val reason = details?.get("reason")?.jsonPrimitive?.contentOrNull) {
        null -> null
        "outside_schedule" -> HouseholdBlock.OutsideSchedule(
            details["next_start_at"]?.jsonPrimitive?.contentOrNull,
        )
        "budget_exhausted" -> HouseholdBlock.BudgetExhausted(
            details["resets_at"]?.jsonPrimitive?.contentOrNull,
        )
        else -> HouseholdBlock.Content(reason)
    }
}

/** Seconds until a `429 pin_locked` lifts, else `null`. */
fun pinLockSecondsOf(status: Int, body: String?): Int? {
    if (status != 429) return null
    val parsed = parseApiErrorBody(body) ?: return null
    if (parsed.error != "pin_locked") return null
    return parsed.details?.get("retry_after_seconds")?.jsonPrimitive?.intOrNull ?: 60
}

private fun HttpException.errorText(): String? =
    runCatching { response()?.errorBody()?.source()?.peek()?.readUtf8() }.getOrNull()

fun HttpException.householdBlock(): HouseholdBlock? = householdBlockOf(code(), errorText())

fun HttpException.pinLockSeconds(): Int? = pinLockSecondsOf(code(), errorText())

/** The server's error code, e.g. `guardian_pin_required`. */
fun HttpException.apiErrorCode(): String? = parseApiErrorBody(errorText())?.error
