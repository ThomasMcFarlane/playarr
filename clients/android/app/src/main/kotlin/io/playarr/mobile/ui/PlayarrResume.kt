package io.playarr.mobile.ui

import io.playarr.shared.data.model.ResumeAction
import io.playarr.shared.data.model.ResumeOptionKind
import io.playarr.shared.data.model.ResumePlan
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Locale

/** Label of the series detail's primary button, from the server's resume plan. */
internal fun ResumePlan.buttonLabel(): PlayarrString = when (action) {
    ResumeAction.Start -> PlayarrString.DetailStartSeries
    ResumeAction.Resume -> PlayarrString.DetailResumeSeries
    ResumeAction.Restart -> PlayarrString.DetailWatchAgain
}

/** Accessible name of the primary button. */
internal fun ResumePlan.buttonTitle(): PlayarrString = when (action) {
    ResumeAction.Start -> PlayarrString.DetailStartSeriesTitle
    ResumeAction.Resume -> PlayarrString.DetailResumeSeriesTitle
    ResumeAction.Restart -> PlayarrString.DetailWatchAgainTitle
}

/** Short caption saying why a chooser option is offered. */
internal fun ResumeOptionKind.caption(): PlayarrString = when (this) {
    ResumeOptionKind.Unfinished -> PlayarrString.ResumeKindUnfinished
    ResumeOptionKind.MissedEpisode -> PlayarrString.ResumeKindMissedEpisode
    ResumeOptionKind.ContinueFromLastWatched -> PlayarrString.ResumeKindContinueFromLast
    ResumeOptionKind.NextInSeries -> PlayarrString.ResumeKindNextInSeries
    ResumeOptionKind.StartOver -> PlayarrString.ResumeKindStartOver
}

/** "4 Oct 2026" in the app language, or null for a missing or invalid stamp. */
internal fun formatResumeDate(value: String?, locale: Locale, zone: ZoneId = ZoneId.systemDefault()): String? {
    if (value.isNullOrBlank()) return null
    val instant = runCatching { Instant.parse(value) }.getOrNull() ?: return null
    return DateTimeFormatter.ofLocalizedDate(FormatStyle.MEDIUM).withLocale(locale).withZone(zone).format(instant)
}
