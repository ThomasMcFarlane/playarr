package io.playarr.mobile.ui

import io.playarr.shared.designsystem.component.PlayarrButton
import io.playarr.shared.designsystem.component.PlayarrButtonVariant
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.ui.graphics.Color
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.border
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
    return playarrLocaleDateTime(instant, zone, locale)
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
    /** Web phone layout: the empty-state group (art circle and copy) over two outlined pills. */
    webPhone: Boolean = false,
    /** Web television layout: the empty-state tile and copy at y 130 and two outlined pills at y 313.6. */
    webTv: Boolean = false,
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

    if (webTv) {
        TelevisionHouseholdBlocked(
            title = title, description = description, sending = sending, requestState = requestState,
            onAsk = {
                sending = true
                scope.launch {
                    requestState = onAskGuardian(block.approvalSubject)
                    sending = false
                }
            },
            onSwitchProfile = onSwitchProfile,
            askFocus = firstAction,
            modifier = modifier,
        )
        return
    }
    if (webPhone) {
        PhoneHouseholdBlocked(
            title = title, description = description, sending = sending, requestState = requestState,
            onAsk = {
                sending = true
                scope.launch {
                    requestState = onAskGuardian(block.approvalSubject)
                    sending = false
                }
            },
            onSwitchProfile = onSwitchProfile,
            modifier = modifier,
        )
        return
    }
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

/** Web `.household-blocked`: art circle and copy side by side 101 px down, two 48 px outlined pills below. */
@Composable
private fun PhoneHouseholdBlocked(
    title: String,
    description: String,
    sending: Boolean,
    requestState: Boolean?,
    onAsk: () -> Unit,
    onSwitchProfile: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val ink = WebInk
    val icon = androidx.compose.ui.graphics.lerp(WebKicker, WebInk, 0.22f)
    val border = if (webIsDark) Color(0xFFDFDCDD).copy(alpha = 0.1157f) else Color(0xFF382621).copy(alpha = 0.139f)
    androidx.compose.foundation.layout.Box(modifier.fillMaxSize().background(WebBackground).semantics { liveRegion = LiveRegionMode.Polite }) {
        androidx.compose.foundation.layout.Column(
            Modifier.fillMaxWidth(),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            androidx.compose.foundation.layout.Spacer(Modifier.height(101.3.dp))
            androidx.compose.foundation.layout.Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(22.dp)) {
                androidx.compose.foundation.layout.Box(
                    Modifier.size(116.dp).background(WebSurfaceStrong.copy(alpha = 0.54f), androidx.compose.foundation.shape.CircleShape)
                        .border(1.dp, border, androidx.compose.foundation.shape.CircleShape),
                    contentAlignment = Alignment.Center,
                ) {
                    androidx.compose.material3.Icon(PlayarrWebIcons.EmptyDetails, contentDescription = null, tint = icon)
                }
                Column(Modifier.widthIn(max = 156.dp)) {
                    Text(title, color = ink, fontSize = 14.4.sp, lineHeight = 21.6.sp, fontWeight = FontWeight(650), letterSpacing = (-0.288).sp, style = WebTextStyle)
                    androidx.compose.foundation.layout.Spacer(Modifier.height(7.2.dp))
                    Text(description, color = WebInkMuted, fontSize = 7.68.sp, lineHeight = 11.52.sp, style = WebTextStyle)
                }
            }
            androidx.compose.foundation.layout.Spacer(Modifier.height(20.dp))
            PhoneHouseholdPill(playarrString(PlayarrString.HouseholdAskGuardian), width = 253.dp, enabled = !sending && requestState != true, onClick = onAsk)
            androidx.compose.foundation.layout.Spacer(Modifier.height(12.dp))
            PhoneHouseholdPill(playarrString(PlayarrString.ProfilesSwitchProfile), width = 143.2.dp, enabled = true, onClick = onSwitchProfile)
            when (requestState) {
                true -> Text(playarrString(PlayarrString.HouseholdRequestSent), color = WebInkSoft, fontSize = 13.sp, textAlign = TextAlign.Center, modifier = Modifier.padding(top = 12.dp))
                false -> Text(
                    playarrString(PlayarrString.HouseholdRequestFailed),
                    color = androidx.compose.material3.MaterialTheme.colorScheme.error, fontSize = 13.sp, textAlign = TextAlign.Center,
                    modifier = Modifier.padding(top = 12.dp),
                )
                null -> Unit
            }
        }
    }
}

/** Web `.household-blocked` at 1920 x 1080 (tile 163.5 at y 130, copy 42.5 to its right, pills 50 high at y 313.6). */
@Composable
private fun TelevisionHouseholdBlocked(
    title: String,
    description: String,
    sending: Boolean,
    requestState: Boolean?,
    onAsk: () -> Unit,
    onSwitchProfile: () -> Unit,
    askFocus: FocusRequester,
    modifier: Modifier = Modifier,
) {
    val icon = androidx.compose.ui.graphics.lerp(WebKicker, WebInk, 0.22f)
    val border = if (webIsDark) Color(0xFFDFDCDD).copy(alpha = 0.1157f) else Color(0xFF382621).copy(alpha = 0.139f)
    androidx.compose.foundation.layout.Box(modifier.fillMaxSize().background(WebBackground).semantics { liveRegion = LiveRegionMode.Polite }) {
        Column(Modifier.fillMaxWidth().padding(top = 130.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            androidx.compose.foundation.layout.Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(42.5.dp)) {
                androidx.compose.foundation.layout.Box(
                    Modifier.size(163.5.dp).background(WebSurfaceStrong.copy(alpha = 0.54f), androidx.compose.foundation.shape.CircleShape)
                        .border(1.dp, border, androidx.compose.foundation.shape.CircleShape),
                    contentAlignment = Alignment.Center,
                ) {
                    androidx.compose.material3.Icon(PlayarrWebIcons.EmptyDetails, contentDescription = null, tint = icon, modifier = Modifier.size(49.6.dp, 32.1.dp))
                }
                Column {
                    Text(title, color = WebInk, fontSize = 22.08.sp, lineHeight = 33.12.sp, fontWeight = FontWeight(650), letterSpacing = (-0.442).sp, style = WebTextStyle)
                    androidx.compose.foundation.layout.Spacer(Modifier.height(7.2.dp))
                    Text(description, color = WebInkMuted, fontSize = 10.752.sp, lineHeight = 16.128.sp, style = WebTextStyle)
                }
            }
            androidx.compose.foundation.layout.Spacer(Modifier.height(20.1.dp))
            androidx.compose.foundation.layout.Row(horizontalArrangement = Arrangement.spacedBy(12.2.dp)) {
                TelevisionHouseholdPill(playarrString(PlayarrString.HouseholdAskGuardian), width = 294.1.dp, enabled = !sending && requestState != true, onClick = onAsk, modifier = Modifier.focusRequester(askFocus))
                TelevisionHouseholdPill(playarrString(PlayarrString.ProfilesSwitchProfile), width = 162.4.dp, enabled = true, onClick = onSwitchProfile)
            }
            when (requestState) {
                true -> Text(playarrString(PlayarrString.HouseholdRequestSent), color = WebInkSoft, fontSize = 13.sp, textAlign = TextAlign.Center, modifier = Modifier.padding(top = 12.dp))
                false -> Text(
                    playarrString(PlayarrString.HouseholdRequestFailed),
                    color = androidx.compose.material3.MaterialTheme.colorScheme.error, fontSize = 13.sp, textAlign = TextAlign.Center,
                    modifier = Modifier.padding(top = 12.dp),
                )
                null -> Unit
            }
        }
    }
}

@Composable
private fun TelevisionHouseholdPill(label: String, width: androidx.compose.ui.unit.Dp, enabled: Boolean, onClick: () -> Unit, modifier: Modifier = Modifier) {
    androidx.compose.material3.Surface(
        onClick = onClick, enabled = enabled, shape = androidx.compose.foundation.shape.CircleShape, color = Color.Transparent, contentColor = WebInk,
        border = androidx.compose.foundation.BorderStroke(1.dp, WebInk), modifier = modifier.size(width, 50.dp),
    ) {
        androidx.compose.foundation.layout.Box(contentAlignment = Alignment.Center) {
            Text(label, fontSize = 16.8.sp, lineHeight = 25.2.sp, style = WebTextStyle, maxLines = 1)
        }
    }
}

@Composable
private fun PhoneHouseholdPill(label: String, width: androidx.compose.ui.unit.Dp, enabled: Boolean, onClick: () -> Unit) {
    androidx.compose.material3.Surface(
        onClick = onClick, enabled = enabled, shape = androidx.compose.foundation.shape.CircleShape, color = Color.Transparent, contentColor = WebInk,
        border = androidx.compose.foundation.BorderStroke(1.dp, WebInk), modifier = Modifier.size(width, 48.dp),
    ) {
        androidx.compose.foundation.layout.Box(contentAlignment = Alignment.Center) {
            Text(label, fontSize = 16.sp, lineHeight = 24.sp, style = WebTextStyle, maxLines = 1)
        }
    }
}
