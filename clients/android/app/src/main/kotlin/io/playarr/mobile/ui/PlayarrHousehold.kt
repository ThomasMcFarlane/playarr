package io.playarr.mobile.ui

import io.playarr.shared.designsystem.component.PlayarrButton
import io.playarr.shared.designsystem.component.PlayarrButtonVariant
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.playarr.shared.data.model.HouseholdStatus
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Locale
import kotlinx.coroutines.launch

/** Why the profile cannot watch right now, derived from the server's status. */
internal sealed interface HouseholdBlockState {
    /** ISO instant the block lifts, when the server knows it. */
    val until: String?

    data class OutsideSchedule(override val until: String?) : HouseholdBlockState
    data class BudgetExhausted(override val until: String?) : HouseholdBlockState

    /** The approval `subject` that would lift this block. */
    val approvalSubject: String
        get() = if (this is OutsideSchedule) "schedule" else "budget"
}

internal fun householdBlockState(status: HouseholdStatus?): HouseholdBlockState? = when (status?.state) {
    "outside_schedule" -> HouseholdBlockState.OutsideSchedule(status.nextStartAt)
    "budget_exhausted" -> HouseholdBlockState.BudgetExhausted(status.resetsAt)
    else -> null
}

/**
 * Whole minutes left in the last hour of a budget or schedule window, else
 * `null`. Uses the nearer of the two limits, like the server's own state.
 */
internal fun householdRemainingMinutes(status: HouseholdStatus?, now: Instant): Int? {
    if (status == null || status.state != "allowed") return null
    val candidates = buildList {
        status.remainingSeconds?.let { add(it / 60.0) }
        status.windowEndsAt?.let { end ->
            runCatching { Instant.parse(end) }.getOrNull()?.let {
                add((it.toEpochMilli() - now.toEpochMilli()) / 60_000.0)
            }
        }
    }
    if (candidates.isEmpty()) return null
    val minutes = kotlin.math.ceil(candidates.min()).toInt().coerceAtLeast(0)
    return minutes.takeIf { it <= 60 }
}

/** An ISO instant in the device's time zone and the app language, or `null`. */
internal fun formatHouseholdInstant(iso: String?, locale: Locale, zone: ZoneId = ZoneId.systemDefault()): String? {
    val instant = iso?.let { runCatching { Instant.parse(it) }.getOrNull() } ?: return null
    return DateTimeFormatter.ofLocalizedDateTime(FormatStyle.MEDIUM, FormatStyle.SHORT)
        .withLocale(locale)
        .format(instant.atZone(zone))
}

/**
 * Full-screen "not available right now" state, shown instead of the app
 * while the server reports the profile outside its schedule or out of daily
 * time. D-pad friendly: the first action takes focus.
 */
@Composable
internal fun HouseholdBlockedScreen(
    block: HouseholdBlockState,
    onAskGuardian: suspend (subject: String) -> Boolean,
    onSwitchProfile: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val language = LocalPlayarrLanguage.current
    val until = formatHouseholdInstant(block.until, language.locale)
    val title = playarrString(
        if (block is HouseholdBlockState.OutsideSchedule) PlayarrString.HouseholdScheduleTitle
        else PlayarrString.HouseholdBudgetTitle,
    )
    val description = when {
        block is HouseholdBlockState.OutsideSchedule && until != null ->
            playarrString(PlayarrString.HouseholdScheduleDescription, "time" to until)
        block is HouseholdBlockState.OutsideSchedule ->
            playarrString(PlayarrString.HouseholdScheduleDescriptionNoTime)
        until != null -> playarrString(PlayarrString.HouseholdBudgetDescription, "time" to until)
        else -> playarrString(PlayarrString.HouseholdBudgetDescriptionNoTime)
    }
    var requestState by remember { mutableStateOf<Boolean?>(null) }
    var sending by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val firstAction = remember { FocusRequester() }
    LaunchedEffect(Unit) { runCatching { firstAction.requestFocus() } }

    Column(
        modifier = modifier
            .fillMaxSize()
            .background(WebBackground)
            .safeDrawingPadding()
            .padding(32.dp)
            .semantics { liveRegion = LiveRegionMode.Polite },
        verticalArrangement = Arrangement.spacedBy(16.dp, Alignment.CenterVertically),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(title, color = WebInk, fontSize = 26.sp, fontWeight = FontWeight.SemiBold, textAlign = TextAlign.Center)
        Text(description, color = WebInkSoft, fontSize = 16.sp, textAlign = TextAlign.Center)
        PlayarrButton(
            onClick = {
                sending = true
                scope.launch {
                    requestState = onAskGuardian(block.approvalSubject)
                    sending = false
                }
            },
            enabled = !sending && requestState != true,
            modifier = Modifier.focusRequester(firstAction),
        ) { Text(playarrString(PlayarrString.HouseholdAskGuardian)) }
        PlayarrButton(onClick = onSwitchProfile, variant = PlayarrButtonVariant.Secondary) {
            Text(playarrString(PlayarrString.ProfilesSwitchProfile))
        }
        when (requestState) {
            true -> Text(playarrString(PlayarrString.HouseholdRequestSent), color = WebInkSoft, fontSize = 13.sp, textAlign = TextAlign.Center)
            false -> Text(
                playarrString(PlayarrString.HouseholdRequestFailed),
                color = androidx.compose.material3.MaterialTheme.colorScheme.error,
                fontSize = 13.sp,
                textAlign = TextAlign.Center,
            )
            null -> Unit
        }
    }
}

/** "N min left" pill for the last hour of a budget or schedule window. */
@Composable
internal fun HouseholdRemainingBadge(minutes: Int, modifier: Modifier = Modifier) {
    androidx.compose.material3.Surface(
        modifier = modifier.safeDrawingPadding().padding(top = 8.dp),
        shape = androidx.compose.foundation.shape.RoundedCornerShape(50),
        color = WebSurfaceStrong,
        contentColor = WebInk,
    ) {
        Text(
            playarrString(PlayarrString.HouseholdRemaining, "minutes" to minutes),
            fontSize = 12.sp,
            modifier = Modifier.padding(horizontal = 12.dp, vertical = 4.dp),
        )
    }
}
