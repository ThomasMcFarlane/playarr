package io.playarr.shared.designsystem.page

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.SemanticsPropertyKey
import androidx.compose.ui.semantics.SemanticsPropertyReceiver
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import io.playarr.shared.designsystem.component.PlayarrButton
import io.playarr.shared.designsystem.theme.PlayarrWebTheme

/** Semantics: the id of the page a layout draws, and which state (if any) fills its body. For tests. */
val PlayarrPageIdKey = SemanticsPropertyKey<PlayarrPageId>("PlayarrPageId")
internal var SemanticsPropertyReceiver.pageIdTag by PlayarrPageIdKey
val PlayarrPageStateKey = SemanticsPropertyKey<String>("PlayarrPageState")
internal var SemanticsPropertyReceiver.pageStateTag by PlayarrPageStateKey

@Composable
internal fun PlayarrPageStateBody(state: PlayarrPageState) {
    when (state) {
        is PlayarrPageState.Loading -> PlayarrLoadingState(state.label)
        is PlayarrPageState.Empty -> PlayarrEmptyState(state.spec)
        is PlayarrPageState.Error -> PlayarrErrorState(state.spec, state.onRetry)
    }
}

/** The one loading state: a spinner and its label, centred in the body. */
@Composable
fun PlayarrLoadingState(label: String) {
    val palette = PlayarrWebTheme.palette
    Box(Modifier.fillMaxSize().semantics { pageStateTag = "loading"; liveRegion = LiveRegionMode.Polite }, contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(14.dp)) {
            CircularProgressIndicator(color = palette.accent)
            Text(label, color = palette.inkMuted)
        }
    }
}

/** The one empty state: a message, with an optional description beneath it. */
@Composable
fun PlayarrEmptyState(spec: PlayarrEmptySpec) {
    val palette = PlayarrWebTheme.palette
    Box(Modifier.fillMaxSize().semantics { pageStateTag = "empty" }, contentAlignment = Alignment.Center) {
        Column(
            modifier = Modifier.padding(32.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Text(
                spec.message,
                color = if (spec.description == null) palette.inkMuted else palette.ink,
                fontWeight = if (spec.description == null) null else FontWeight.SemiBold,
                textAlign = TextAlign.Center,
            )
            spec.description?.let { Text(it, color = palette.inkMuted, textAlign = TextAlign.Center) }
        }
    }
}

/** [PlayarrEmptyState] for a plain message and optional description. */
@Composable
fun PlayarrEmptyState(message: String, description: String? = null) = PlayarrEmptyState(PlayarrEmptySpec(message, description))

/** The one error state: the message in the danger colour and a retry action when one is offered. */
@Composable
fun PlayarrErrorState(spec: PlayarrErrorSpec, onRetry: (() -> Unit)?) {
    val palette = PlayarrWebTheme.palette
    Box(Modifier.fillMaxSize().semantics { pageStateTag = "error"; liveRegion = LiveRegionMode.Assertive }, contentAlignment = Alignment.Center) {
        Column(
            modifier = Modifier.padding(32.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            Text(spec.message, color = palette.danger, textAlign = TextAlign.Center)
            if (onRetry != null && spec.retryLabel != null) PlayarrButton(onClick = onRetry) { Text(spec.retryLabel) }
        }
    }
}
