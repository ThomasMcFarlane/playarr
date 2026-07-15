package io.streamarr.shared.data.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * Kotlin mirror of `streamarr-model::policy`. The client receives the
 * caller's own resolved [Policy] (never anyone else's) so UI code can gate
 * affordances client-side (e.g. hide the download button when
 * `canDownload` is false) ahead of the server enforcing the same rule.
 * Authoritative enforcement always happens server-side; this is a UX
 * optimization, not a trust boundary.
 */
@Serializable
enum class Weekday {
    @SerialName("monday") Monday,
    @SerialName("tuesday") Tuesday,
    @SerialName("wednesday") Wednesday,
    @SerialName("thursday") Thursday,
    @SerialName("friday") Friday,
    @SerialName("saturday") Saturday,
    @SerialName("sunday") Sunday,
}

/**
 * A minute-of-day range, e.g. 06:00-22:00. Stored as minutes-since-midnight
 * to match the server representation exactly (no timezone conversion at
 * this layer -- the caller supplies the user's local minute of day).
 */
@Serializable
data class TimeRange(
    val startMinuteOfDay: Int,
    val endMinuteOfDay: Int,
)

@Serializable
data class AccessWindow(
    val weekday: Weekday,
    val timeRange: TimeRange,
)

@Serializable
data class Policy(
    val id: String,
    val name: String,

    /** Work/library root ids this policy grants browse/playback access to. */
    val libraryAllow: List<String> = emptyList(),
    val blockedFolders: List<String> = emptyList(),
    /** Content-rating ceiling, e.g. `"PG-13"`. */
    val maxRating: String? = null,
    val blockedTags: List<String> = emptyList(),
    val allowedTags: List<String> = emptyList(),

    val canTranscode: Boolean,
    val canDownload: Boolean,
    val canDelete: Boolean,
    val canSharePublic: Boolean,

    val deviceAllow: List<ClientPlatform> = emptyList(),
    val maxConcurrentSessions: Int? = null,
    /** `null` means "no schedule restriction" (always allowed); empty list means "never allowed." */
    val accessSchedule: List<AccessWindow>? = null,

    /** Bypasses every other field on this object. */
    val isAdmin: Boolean,
)
