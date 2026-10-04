package io.playarr.shared.data.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * Kotlin mirror of the smart Start/Resume schemas in
 * `backend/openapi/playarr.yaml` (`ResumePlan`, `ResumeOption`,
 * `ResumeChoiceRequest`, `ResumeClearResponse`). The rules live on the server
 * (`docs/architecture/smart-resume.md`); clients only render the plan.
 */
@Serializable
enum class ResumeAction {
    @SerialName("start") Start,
    @SerialName("resume") Resume,
    @SerialName("restart") Restart,
}

@Serializable
enum class ResumeOptionKind {
    @SerialName("unfinished") Unfinished,
    @SerialName("missed_episode") MissedEpisode,
    @SerialName("continue_from_last_watched") ContinueFromLastWatched,
    @SerialName("next_in_series") NextInSeries,
    @SerialName("start_over") StartOver,
}

@Serializable
data class ResumeOption(
    val kind: ResumeOptionKind,
    @SerialName("episode_id") val episodeId: String,
    @SerialName("media_file_id") val mediaFileId: String,
    @SerialName("season_number") val seasonNumber: Int,
    @SerialName("episode_number") val episodeNumber: Int,
    @SerialName("episode_number_end") val episodeNumberEnd: Int? = null,
    /** `S01E05`, or `S01E01-E02` for a multi-episode file. */
    val label: String,
    val title: String? = null,
    @SerialName("position_ms") val positionMs: Long = 0,
    @SerialName("duration_ms") val durationMs: Long = 0,
    @SerialName("progress_percent") val progressPercent: Int = 0,
    @SerialName("last_watched_at") val lastWatchedAt: String? = null,
    @SerialName("anchor_episode_id") val anchorEpisodeId: String? = null,
)

@Serializable
data class ResumePlan(
    @SerialName("series_work_id") val seriesWorkId: String,
    val action: ResumeAction,
    /** Deterministic server-side reason code (for logs and tests). */
    val reason: String = "",
    @SerialName("needs_choice") val needsChoice: Boolean = false,
    @SerialName("ask_reasons") val askReasons: List<String> = emptyList(),
    val target: ResumeOption? = null,
    val options: List<ResumeOption> = emptyList(),
) {
    /** True when the chooser must be shown (several options to pick from). */
    val isStacked: Boolean get() = needsChoice && options.size > 1
}

@Serializable
data class ResumeChoiceRequest(
    val kind: ResumeOptionKind,
    @SerialName("episode_id") val episodeId: String,
)

@Serializable
data class ResumeClearResponse(val removed: Long = 0)
