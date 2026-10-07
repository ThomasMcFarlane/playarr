package io.playarr.mobile.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.playarr.shared.data.model.ResumeOption
import io.playarr.shared.designsystem.component.PlayarrButton
import io.playarr.shared.designsystem.component.PlayarrButtonVariant
import io.playarr.shared.data.model.ResumeOptionKind
import io.playarr.shared.data.model.ResumePlan

/**
 * Asks where to continue a series when the server's resume plan found an
 * ambiguity (unfinished episodes, a missed episode, a rewatch). Every option
 * is a focusable surface, so the D-pad, a controller and touch all work; Back
 * dismisses without choosing (nothing is recorded). The first option takes
 * initial focus.
 */
@Composable
internal fun PlayarrResumeChooserDialog(
    plan: ResumePlan,
    seriesTitle: String,
    onDismiss: () -> Unit,
    onSelect: (ResumeOption) -> Unit,
) {
    val language = LocalPlayarrLanguage.current
    val firstFocus = remember { FocusRequester() }
    LaunchedEffect(plan) { runCatching { firstFocus.requestFocus() } }
    PlayarrPanel(
        onDismissRequest = onDismiss,
        title = {
            Column(Modifier.semantics { contentDescription = seriesTitle }, verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text(
                    playarrString(PlayarrString.ResumeChooserSubtitle).uppercase(),
                    color = WebKicker,
                    fontSize = 11.sp,
                    fontWeight = FontWeight.SemiBold,
                )
                Text(
                    playarrString(PlayarrString.ResumeChooserTitle, "title" to seriesTitle),
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        },
        text = {
            Column(
                Modifier.fillMaxWidth().heightIn(max = 640.dp).playarrVerticalScroll(),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                plan.options.forEachIndexed { index, option ->
                    ResumeOptionRow(
                        option = option,
                        lastWatched = formatResumeDate(option.lastWatchedAt, language.locale),
                        modifier = if (index == 0) Modifier.focusRequester(firstFocus) else Modifier,
                        onClick = { onSelect(option) },
                    )
                }
            }
        },
        confirmButton = {
            PlayarrButton(onClick = onDismiss, variant = PlayarrButtonVariant.Ghost) {
                Text(playarrString(PlayarrString.CommonCancel))
            }
        },
    )
}

@Composable
private fun ResumeOptionRow(
    option: ResumeOption,
    lastWatched: String?,
    modifier: Modifier,
    onClick: () -> Unit,
) {
    var focused by remember { mutableStateOf(false) }
    Surface(
        onClick = onClick,
        color = WebSurface,
        contentColor = WebInk,
        shape = RoundedCornerShape(8.dp),
        border = BorderStroke(if (focused) 2.dp else 1.dp, if (focused) WebPink else WebInkSoft.copy(alpha = 0.4f)),
        modifier = modifier.fillMaxWidth().onFocusChanged { focused = it.isFocused },
    ) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(
                playarrString(option.kind.caption()).uppercase(),
                color = WebInkMuted,
                fontSize = 10.sp,
                fontWeight = FontWeight.SemiBold,
            )
            Text(
                listOfNotNull(option.label, option.title?.takeIf(String::isNotBlank)).joinToString(" · "),
                fontSize = 15.sp,
                fontWeight = FontWeight.SemiBold,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
            lastWatched?.let {
                Text(
                    playarrString(PlayarrString.ResumeLastWatched, "date" to it),
                    color = WebInkMuted,
                    fontSize = 12.sp,
                )
            }
            if (option.kind == ResumeOptionKind.Unfinished) {
                val progressLabel = playarrString(PlayarrString.ResumePercentWatched, "percent" to option.progressPercent)
                LinearProgressIndicator(
                    progress = { (option.progressPercent / 100f).coerceIn(0f, 1f) },
                    color = WebPink,
                    trackColor = WebInk.copy(alpha = 0.16f),
                    modifier = Modifier.fillMaxWidth().height(4.dp).semantics {
                        contentDescription = progressLabel
                    },
                )
            }
        }
    }
}
