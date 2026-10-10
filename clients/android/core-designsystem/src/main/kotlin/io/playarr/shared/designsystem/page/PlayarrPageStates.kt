package io.playarr.shared.designsystem.page

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.unit.sp
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
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
    if (spec.art != null && LocalPlayarrFormFactor.current == PlayarrFormFactor.Tv) {
        // Web `.tv-empty-state.is-rail.graphic-search`: the 132 dp circle (`--surface-strong` 54%, hairline border) with the
        // 54 x 36 magnifier in brand ink, 42 dp before the copy (16.896 px / 650 title, muted description).
        // `.is-rail`: the group is centred in the top 52% of the area under its padding (0.46 of the body here), not in all of it.
        Row(
            Modifier.fillMaxWidth().fillMaxHeight(0.46f).semantics { pageStateTag = "empty" },
            horizontalArrangement = Arrangement.spacedBy(42.dp, Alignment.CenterHorizontally),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            val glyph = androidx.compose.ui.graphics.lerp(palette.ink, androidx.compose.ui.graphics.Color(0xFFCF3157), 0.78f)
            Box(
                Modifier.size(132.dp)
                    .background(palette.surfaceStrong.copy(alpha = 0.54f), CircleShape)
                    .border(1.dp, palette.hairline(0.15f, 0.18f).copy(alpha = 0.5f), CircleShape),
                contentAlignment = Alignment.Center,
            ) {
                Canvas(Modifier.size(54.dp, 36.dp)) {
                    // The web SVG (viewBox 48 x 32): a circle r 9 at (21, 14), the handle and the bar.
                    val k = size.width / 48f
                    val stroke = Stroke(width = 1.8f * k, cap = StrokeCap.Round, join = StrokeJoin.Round)
                    drawCircle(glyph, radius = 9f * k, center = Offset(21f * k, 14f * k), style = stroke)
                    drawLine(glyph, Offset(28f * k, 21f * k), Offset(37f * k, 29f * k), strokeWidth = 1.8f * k, cap = StrokeCap.Round)
                    drawLine(glyph, Offset(17f * k, 14f * k), Offset(25f * k, 14f * k), strokeWidth = 1.8f * k, cap = StrokeCap.Round)
                }
            }
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text(spec.message, color = palette.ink, fontSize = 16.896.sp, lineHeight = 25.344.sp, fontWeight = FontWeight(650))
                spec.description?.let { Text(it, color = palette.inkMuted, fontSize = 13.sp) }
            }
        }
        return
    }
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
