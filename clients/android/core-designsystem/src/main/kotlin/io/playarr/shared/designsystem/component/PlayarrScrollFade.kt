package io.playarr.shared.designsystem.component

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.ScrollState
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.grid.LazyGridState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.staticCompositionLocalOf
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
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/*
 * The one scroll-edge fade. The web client draws a soft shadow on every edge of a scroll container that still has
 * content beyond it (`.tv-home-rail-window.can-scroll-right::after`, `.tv-library-grid-panel.can-scroll-down::after`,
 * `.tv-scroll-edge-window.can-scroll-up::before`, and so on): an elliptical radial gradient of the ink colour
 * `rgb(31 14 20)` centred just beyond the edge, rounded 48% on its inner side, plus a narrow inset shadow along the
 * edge, faded in over 180 ms. This is that recipe, once, for every scrollable container on every Android layout.
 */

/** Web-sized variants of the fade. */
enum class PlayarrFadeKind(
    /** Depth of the fade into the container (the web's pseudo-element width or height at 1920 x 1080). */
    val thickness: Dp,
    /** Ink alpha at the very edge and at 46% of the ramp (`rgba(31, 14, 20, a)` stops). */
    val edgeAlpha: Float,
    val midAlpha: Float,
    /** Length of the ellipse along the edge, as a fraction of the container's length on that edge. */
    val spread: Float,
    val lightOpacity: Float,
    val darkOpacity: Float,
) {
    /** `.tv-home-rail-window::before/::after`: 58 px wide on a rail of cards. */
    Rail(58.dp, 0.5f, 0.18f, 0.88f, 0.58f, 0.5f),

    /** `.tv-library-grid-panel::before/::after`: 59.4 px deep over a grid, and its cover-flow row. */
    Grid(59.4.dp, 0.5f, 0.18f, 0.92f, 0.62f, 0.54f),

    /** `.tv-scroll-edge-window::before/::after`: 43.2 px deep over a page, panel, list or dialog. */
    Panel(43.2.dp, 0.42f, 0.12f, 0.82f, 0.58f, 0.58f),

    /** The 32 px phone rail edge (`.tv-home-rail-window::after` under 700 px). */
    PhoneRail(32.dp, 0.5f, 0.18f, 0.88f, 0.58f, 0.5f),
}

/** Whether the app is showing its dark theme; the fade differs between themes. The app provides it. */
val LocalPlayarrDarkTheme = staticCompositionLocalOf { true }

/**
 * The page background the dark-theme fade is drawn in. A radial shade of the near-black ink is invisible on a
 * near-black page, so in the dark theme the web fades the page background over the content instead (web
 * `--edge-scrim-*`: `clamp(56px, 8vh, 104px)` deep, 96% opaque at the edge, 60% of that at 40%, clear at the end).
 */
val LocalPlayarrFadeBackground = staticCompositionLocalOf { Color(0xFF151315) }

private val FadeInk = Color(0xFF1F0E14)

/**
 * Draws the fade on the start and/or end edge of this container. [startVisible] and [endVisible] say whether content
 * continues beyond that edge (can scroll backward / forward). Nothing is drawn, and nothing is measured, when neither is.
 */
@Composable
fun Modifier.playarrEdgeFade(
    startVisible: Boolean,
    endVisible: Boolean,
    vertical: Boolean,
    kind: PlayarrFadeKind = if (vertical) PlayarrFadeKind.Panel else PlayarrFadeKind.Rail,
): Modifier {
    val dark = LocalPlayarrDarkTheme.current
    val background = LocalPlayarrFadeBackground.current
    val scrimDepth = (LocalConfiguration.current.screenHeightDp * 0.08f).coerceIn(56f, 104f).dp
    // Dark: the page-background scrim at full strength; light: the ink shade at the web's per-kind opacity.
    val opacity = if (dark) 1f else kind.lightOpacity
    val start by animateFloatAsState(if (startVisible) opacity else 0f, tween(180), label = "scrollFadeStart")
    val end by animateFloatAsState(if (endVisible) opacity else 0f, tween(180), label = "scrollFadeEnd")
    if (start <= 0f && end <= 0f) return this
    return drawWithContent {
        drawContent()
        if (dark) {
            if (start > 0f) drawScrimEdge(vertical, atStart = true, depth = scrimDepth.toPx(), background = background, opacity = start)
            if (end > 0f) drawScrimEdge(vertical, atStart = false, depth = scrimDepth.toPx(), background = background, opacity = end)
        } else {
            if (start > 0f) drawFadeEdge(vertical, atStart = true, kind = kind, opacity = start)
            if (end > 0f) drawFadeEdge(vertical, atStart = false, kind = kind, opacity = end)
        }
    }
}

/** The fade for a [LazyListState] list or row. */
@Composable
fun Modifier.playarrScrollFade(
    state: LazyListState,
    vertical: Boolean,
    kind: PlayarrFadeKind = if (vertical) PlayarrFadeKind.Panel else PlayarrFadeKind.Rail,
): Modifier {
    val start by remember(state) { derivedStateOf { state.canScrollBackward } }
    val end by remember(state) { derivedStateOf { state.canScrollForward } }
    return playarrEdgeFade(start, end, vertical, kind)
}

/** The fade for a [LazyGridState] grid. */
@Composable
fun Modifier.playarrScrollFade(
    state: LazyGridState,
    vertical: Boolean = true,
    kind: PlayarrFadeKind = PlayarrFadeKind.Grid,
): Modifier {
    val start by remember(state) { derivedStateOf { state.canScrollBackward } }
    val end by remember(state) { derivedStateOf { state.canScrollForward } }
    return playarrEdgeFade(start, end, vertical, kind)
}

/** The fade for a `verticalScroll` / `horizontalScroll` container driven by [state]. */
@Composable
fun Modifier.playarrScrollFade(
    state: ScrollState,
    vertical: Boolean,
    kind: PlayarrFadeKind = if (vertical) PlayarrFadeKind.Panel else PlayarrFadeKind.Rail,
): Modifier {
    val start by remember(state) { derivedStateOf { state.canScrollBackward } }
    val end by remember(state) { derivedStateOf { state.canScrollForward } }
    return playarrEdgeFade(start, end, vertical, kind)
}

private fun DrawScope.drawFadeEdge(vertical: Boolean, atStart: Boolean, kind: PlayarrFadeKind, opacity: Float) {
    val length = if (vertical) size.width else size.height
    val depth = minOf(kind.thickness.toPx(), if (vertical) size.height else size.width)
    if (length <= 0f || depth <= 0f) return
    // The fade's own box: `depth` deep, the full length of the edge.
    val left = if (vertical) 0f else if (atStart) 0f else size.width - depth
    val top = if (!vertical) 0f else if (atStart) 0f else size.height - depth
    val boxW = if (vertical) length else depth
    val boxH = if (vertical) depth else length
    // CSS `border-radius: 48%` on the two corners on the container-interior side.
    val rx = 0.48f * boxW
    val ry = 0.48f * boxH
    val zero = CornerRadius.Zero
    val round = CornerRadius(rx, ry)
    val shape = Path().apply {
        addRoundRect(
            RoundRect(
                left, top, left + boxW, top + boxH,
                topLeftCornerRadius = if (atStart && !vertical || vertical && atStart) zero else round,
                topRightCornerRadius = if (vertical) (if (atStart) zero else round) else (if (atStart) round else zero),
                bottomRightCornerRadius = if (atStart) round else zero,
                bottomLeftCornerRadius = if (vertical) (if (atStart) round else zero) else (if (atStart) zero else round),
            ),
        )
    }
    val ellipseLength = kind.spread * length
    // `radial-gradient(ellipse ... at 50% 128%)`: centred 28% of the depth beyond the edge, circle stretched along it.
    val outward = 0.28f * depth
    val centre = if (vertical) {
        Offset(left + boxW / 2f, if (atStart) top - outward else top + depth + outward)
    } else {
        Offset(if (atStart) left - outward else left + depth + outward, top + boxH / 2f)
    }
    val stretch = ellipseLength / depth
    withTransform({
        clipPath(shape)
    }) {
        withTransform({
            if (vertical) scale(stretch, 1f, pivot = centre) else scale(1f, stretch, pivot = centre)
        }) {
            drawCircle(
                brush = Brush.radialGradient(
                    0f to FadeInk.copy(alpha = kind.edgeAlpha * opacity),
                    0.46f to FadeInk.copy(alpha = kind.midAlpha * opacity),
                    0.78f to Color.Transparent,
                    center = centre,
                    radius = depth * 1.28f,
                ),
                radius = depth * 4f,
                center = centre,
            )
        }
        // `box-shadow: inset 0 -18px 24px -22px`: the darkening that hugs the container's edge.
        val band = minOf(14.dp.toPx(), depth)
        val bandAlpha = 0.17f * opacity
        val brush = when {
            vertical && atStart -> Brush.verticalGradient(0f to FadeInk.copy(alpha = bandAlpha), 1f to Color.Transparent, startY = top, endY = top + band)
            vertical -> Brush.verticalGradient(0f to Color.Transparent, 1f to FadeInk.copy(alpha = bandAlpha), startY = top + depth - band, endY = top + depth)
            atStart -> Brush.horizontalGradient(0f to FadeInk.copy(alpha = bandAlpha), 1f to Color.Transparent, startX = left, endX = left + band)
            else -> Brush.horizontalGradient(0f to Color.Transparent, 1f to FadeInk.copy(alpha = bandAlpha), startX = left + depth - band, endX = left + depth)
        }
        val bandTopLeft = when {
            vertical && atStart -> Offset(left, top)
            vertical -> Offset(left, top + depth - band)
            atStart -> Offset(left, top)
            else -> Offset(left + depth - band, top)
        }
        val bandSize = if (vertical) Size(boxW, band) else Size(band, boxH)
        drawRect(brush, topLeft = bandTopLeft, size = bandSize)
    }
}

/** Dark theme: the page background fading to clear from the edge inwards (web `--edge-scrim-*`). */
private fun DrawScope.drawScrimEdge(vertical: Boolean, atStart: Boolean, depth: Float, background: Color, opacity: Float) {
    val length = if (vertical) size.height else size.width
    val d = minOf(depth, length)
    if (d <= 0f) return
    val edge = 0.96f * opacity
    val stops = arrayOf(0f to background.copy(alpha = edge), 0.4f to background.copy(alpha = edge * 0.6f), 1f to Color.Transparent)
    if (vertical) {
        val top = if (atStart) 0f else size.height - d
        val brush = if (atStart) {
            Brush.verticalGradient(*stops, startY = top, endY = top + d)
        } else {
            Brush.verticalGradient(*stops, startY = top + d, endY = top)
        }
        drawRect(brush, topLeft = Offset(0f, top), size = Size(size.width, d))
    } else {
        val left = if (atStart) 0f else size.width - d
        val brush = if (atStart) {
            Brush.horizontalGradient(*stops, startX = left, endX = left + d)
        } else {
            Brush.horizontalGradient(*stops, startX = left + d, endX = left)
        }
        drawRect(brush, topLeft = Offset(left, 0f), size = Size(d, size.height))
    }
}
