package io.playarr.shared.designsystem.page

import androidx.compose.foundation.gestures.Orientation
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyGridScope
import androidx.compose.foundation.lazy.grid.LazyGridState
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.RoundRect
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.clipPath
import androidx.compose.ui.graphics.drawscope.withTransform
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.semantics.SemanticsPropertyKey
import androidx.compose.ui.semantics.SemanticsPropertyReceiver
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import io.playarr.shared.designsystem.theme.PlayarrWebPalette
import io.playarr.shared.designsystem.theme.PlayarrWebTheme

/** Which edges of a scroll viewport have content beyond them, and so show the fade. */
data class PlayarrScrollEdges(val top: Boolean = false, val bottom: Boolean = false, val start: Boolean = false, val end: Boolean = false) {
    override fun toString(): String = listOfNotNull(
        "top".takeIf { top }, "bottom".takeIf { bottom }, "start".takeIf { start }, "end".takeIf { end },
    ).joinToString(",")

    companion object {
        fun of(canScrollBackward: Boolean, canScrollForward: Boolean, axis: Orientation) =
            if (axis == Orientation.Vertical) PlayarrScrollEdges(top = canScrollBackward, bottom = canScrollForward)
            else PlayarrScrollEdges(start = canScrollBackward, end = canScrollForward)
    }
}

/** Semantics: the edges currently faded. For tests. */
val PlayarrScrollEdgesKey = SemanticsPropertyKey<PlayarrScrollEdges>("PlayarrScrollEdges")
internal var SemanticsPropertyReceiver.scrollEdges by PlayarrScrollEdgesKey

/**
 * The one edge fade (owner rule: every scrollable area, both themes), matching web's rail-panel glow
 * (`.tv-library-grid-panel.can-scroll-*`) in the light theme and the stronger page-background scrim
 * (`--edge-scrim-*`) in the dark theme.
 *
 * Light: a radial shade `rgb(31 14 20)` (0.5, 0.18 at 46%, clear at 78%) at 0.62 opacity, clamp(38, 5.5 vu, 64) tall
 * on the top and bottom edges. Dark: the page background fading to clear over clamp(56, 8 vu, 104), 0.96 opaque,
 * holding 60% at 40% of its length. One viewport unit is 1% of the screen height.
 *
 * Apply it to the viewport, outside the scrolling modifier. The edges are also published in semantics.
 */
@Composable
fun Modifier.playarrEdgeFades(canScrollBackward: Boolean, canScrollForward: Boolean, axis: Orientation): Modifier =
    playarrEdgeFades(PlayarrScrollEdges.of(canScrollBackward, canScrollForward, axis))

@Composable
internal fun Modifier.playarrEdgeFades(edges: PlayarrScrollEdges): Modifier {
    val config = LocalConfiguration.current
    val palette = PlayarrWebTheme.palette
    val unit = config.screenHeightDp / 100f
    val lightBand = (PlayarrEdgeFadeTokens.LightBandViewportPercent * unit).coerceIn(PlayarrEdgeFadeTokens.LightBandMinDp, PlayarrEdgeFadeTokens.LightBandMaxDp).dp
    val darkBand = (PlayarrEdgeFadeTokens.DarkBandViewportPercent * unit).coerceIn(PlayarrEdgeFadeTokens.DarkBandMinDp, PlayarrEdgeFadeTokens.DarkBandMaxDp).dp
    val horizontalLight = (config.screenWidthDp * 0.036f).coerceIn(32f, 58f).dp
    return this
        .semantics { scrollEdges = edges }
        .drawWithContent {
            drawContent()
            if (palette.dark) drawDarkScrims(edges, palette, darkBand.toPx())
            else drawLightShades(edges, lightBand.toPx(), horizontalLight.toPx())
        }
}

private fun DrawScope.drawDarkScrims(edges: PlayarrScrollEdges, palette: PlayarrWebPalette, band: Float) {
    if (edges.top) drawScrim(palette.background, Offset(0f, 0f), Offset(0f, band), band.coerceAtMost(size.height), horizontal = true)
    if (edges.bottom) drawScrim(palette.background, Offset(0f, size.height), Offset(0f, size.height - band), band.coerceAtMost(size.height), horizontal = true)
    if (edges.start) drawScrim(palette.background, Offset(0f, 0f), Offset(band, 0f), band.coerceAtMost(size.width), horizontal = false)
    if (edges.end) drawScrim(palette.background, Offset(size.width, 0f), Offset(size.width - band, 0f), band.coerceAtMost(size.width), horizontal = false)
}

/** The page background fading to clear from [from] (opaque) towards [to] over [length]; web dark `--edge-scrim-*`. */
private fun DrawScope.drawScrim(background: Color, from: Offset, to: Offset, length: Float, horizontal: Boolean) {
    val brush = Brush.linearGradient(
        0f to background.copy(alpha = PlayarrEdgeFadeTokens.DarkScrimOpacity),
        PlayarrEdgeFadeTokens.DarkScrimMidStop to background.copy(alpha = PlayarrEdgeFadeTokens.DarkScrimOpacity * PlayarrEdgeFadeTokens.DarkScrimMidAlpha),
        1f to Color.Transparent,
        start = from, end = to,
    )
    if (horizontal) {
        drawRect(brush, topLeft = Offset(0f, minOf(from.y, to.y)), size = Size(size.width, length))
    } else {
        drawRect(brush, topLeft = Offset(minOf(from.x, to.x), 0f), size = Size(length, size.height))
    }
}

private fun DrawScope.drawLightShades(edges: PlayarrScrollEdges, vertical: Float, horizontal: Float) {
    if (edges.top) drawVerticalShade(top = true, vertical)
    if (edges.bottom) drawVerticalShade(top = false, vertical)
    if (edges.start) drawHorizontalShade(start = true, horizontal)
    if (edges.end) drawHorizontalShade(start = false, horizontal)
}

private val ShadeInk = Color(PlayarrEdgeFadeTokens.LightShadeArgb)

private fun shadeBrush(centre: Offset, radius: Float, centreAlpha: Float, midAlpha: Float, midStop: Float): Brush = Brush.radialGradient(
    0f to ShadeInk.copy(alpha = centreAlpha * PlayarrEdgeFadeTokens.LightOpacity),
    midStop to ShadeInk.copy(alpha = midAlpha * PlayarrEdgeFadeTokens.LightOpacity),
    PlayarrEdgeFadeTokens.LightEndStop to Color.Transparent,
    center = centre, radius = radius,
)

private fun DrawScope.drawVerticalShade(top: Boolean, band: Float) {
    val w = size.width
    val round = CornerRadius(0.5f * w, 0.5f * band)
    val shape = Path().apply {
        addRoundRect(
            if (top) RoundRect(0f, 0f, w, band, CornerRadius.Zero, CornerRadius.Zero, round, round)
            else RoundRect(0f, size.height - band, w, size.height, round, round, CornerRadius.Zero, CornerRadius.Zero),
        )
    }
    val top0 = if (top) 0f else size.height - band
    // ellipse 92% 100% at 50% -28% (top) / 50% 128% (bottom)
    val centre = Offset(0.5f * w, top0 + band * if (top) -0.28f else 1.28f)
    val rx = 0.92f * w
    clipPath(shape) {
        withTransform({ scale(1f, band / rx, pivot = centre) }) {
            drawCircle(
                brush = shadeBrush(centre, rx, PlayarrEdgeFadeTokens.LightCentreAlpha, PlayarrEdgeFadeTokens.LightMidAlpha, PlayarrEdgeFadeTokens.LightMidStop),
                radius = rx, center = centre,
            )
        }
    }
}

private fun DrawScope.drawHorizontalShade(start: Boolean, band: Float) {
    val h = size.height
    val left = if (start) 0f else size.width - band
    val round = CornerRadius(0.48f * band, 0.48f * h)
    val shape = Path().apply {
        addRoundRect(
            if (start) RoundRect(left, 0f, left + band, h, CornerRadius.Zero, round, round, CornerRadius.Zero)
            else RoundRect(left, 0f, left + band, h, round, CornerRadius.Zero, CornerRadius.Zero, round),
        )
    }
    // ellipse 100% 88% at -24% 50% (start) / 124% 50% (end)
    val centre = Offset(left + band * if (start) -0.24f else 1.24f, h / 2f)
    val ry = 0.88f * h
    clipPath(shape) {
        withTransform({ scale(1f, ry / band, pivot = centre) }) {
            drawCircle(
                brush = shadeBrush(centre, band, 0.52f, 0.18f, 0.48f),
                radius = band, center = centre,
            )
        }
    }
}

/** A vertical lazy list whose viewport shows the edge fades. */
@Composable
fun PlayarrScrollColumn(
    state: LazyListState,
    scrollKey: String,
    contentPadding: PaddingValues = PaddingValues(0.dp),
    verticalArrangement: Arrangement.Vertical = Arrangement.Top,
    content: LazyListScope.() -> Unit,
) {
    LazyColumn(
        state = state,
        contentPadding = contentPadding,
        verticalArrangement = verticalArrangement,
        modifier = Modifier.fillMaxSize().playarrEdgeFades(state.canScrollBackward, state.canScrollForward, Orientation.Vertical),
        content = content,
    )
}

/** A lazy grid whose viewport shows the edge fades. */
@Composable
fun PlayarrScrollGrid(
    state: LazyGridState,
    columns: GridCells,
    scrollKey: String,
    contentPadding: PaddingValues = PaddingValues(0.dp),
    verticalArrangement: Arrangement.Vertical = Arrangement.Top,
    horizontalArrangement: Arrangement.Horizontal = Arrangement.Start,
    content: LazyGridScope.() -> Unit,
) {
    LazyVerticalGrid(
        columns = columns,
        state = state,
        contentPadding = contentPadding,
        verticalArrangement = verticalArrangement,
        horizontalArrangement = horizontalArrangement,
        modifier = Modifier.fillMaxSize().playarrEdgeFades(state.canScrollBackward, state.canScrollForward, Orientation.Vertical),
        content = content,
    )
}

/** A horizontal lazy row whose viewport shows the edge fades. */
@Composable
fun PlayarrScrollRow(
    state: LazyListState,
    scrollKey: String,
    contentPadding: PaddingValues = PaddingValues(0.dp),
    horizontalArrangement: Arrangement.Horizontal = Arrangement.Start,
    content: LazyListScope.() -> Unit,
) {
    LazyRow(
        state = state,
        contentPadding = contentPadding,
        horizontalArrangement = horizontalArrangement,
        modifier = Modifier.fillMaxSize().playarrEdgeFades(state.canScrollBackward, state.canScrollForward, Orientation.Horizontal),
        content = content,
    )
}
