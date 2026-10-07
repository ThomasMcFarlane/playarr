package io.playarr.mobile.ui

import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.Easing
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import io.playarr.shared.designsystem.component.PlayarrFocusRingWidth
import io.playarr.shared.designsystem.component.playarrFocusRing

/*
 * The Playarr focus indicator: a 3 px ring and no background fill, on every focusable control and card. Owner ruling:
 * white in the dark theme and the near-black ink in the light theme, so the ring always contrasts with the artwork
 * and surfaces it sits on. (Web draws it as `outline: 3px solid` and, on card art, a 3 px `box-shadow` spread.)
 */
internal val WebFocusRing: Color get() = if (webIsDark) Color.White else WebInk

/** Card ring: the same ring, drawn flush against the artwork. */
internal val WebCardFocusRing: Color get() = WebFocusRing

/** Draws the web focus ring around this element while [focused]; see [playarrFocusRing]. */
internal fun Modifier.webFocusRing(
    focused: Boolean,
    radius: Dp? = null,
    offset: Dp = 0.dp,
    width: Dp = PlayarrFocusRingWidth,
    color: Color? = null,
): Modifier = playarrFocusRing(focused, color ?: WebFocusRing, radius, offset, width)

/*
 * Owner ruling (8 October): a focused media card (poster, thumbnail, episode tile, cast or content card) shows a soft
 * shadow and lifts, animated, with no ring and no fill. Buttons, pills and Back keep the ring.
 *
 * The lift is draw-only. Compose's 2D focus search reads the bounds of the focus target through the layer transforms of
 * the target and its ancestors; a lifted target made a lifted neighbour sit "below" its sibling and focus bounced
 * sideways forever (the #214 regression). So [mediaCardLift] is applied to the CONTENT inside the focus target, never
 * to the focus target itself: the target keeps its unlifted layout bounds and only its child is translated at draw time.
 */
/**
 * Web card focus (reference commit de371253, pinned in docs/design/page-layout.md section 5 item 1a). Web TV is 1920x1080 px
 * and Android TV runs the same layout at 1 dp = 1 px, so the CSS values carry over unchanged.
 */
internal data class TvCardMotion(val lift: Dp, val scale: Float, val durationMs: Int, val easing: Easing)

private val CardEase = CubicBezierEasing(0.2f, 0.8f, 0.2f, 1f)
internal object TvCardMotions {
    /** `.tv-episode-card` and other cards: translateY(-7px), 260 ms. */
    val Card = TvCardMotion(7.dp, 1f, 260, CardEase)
    /** `.tv-home-card`: translateY(-6px). */
    val Home = TvCardMotion(6.dp, 1f, 260, CardEase)
    /** `.tv-title-card` (library grid): translateY(-5px) scale(1.015). */
    val Library = TvCardMotion(5.dp, 1.015f, 260, CardEase)
    /** `.tv-search-result`: translateY(-6px) scale(1.015), 230 ms cubic-bezier(0.16, 1, 0.3, 1). */
    val Search = TvCardMotion(6.dp, 1.015f, 230, CubicBezierEasing(0.16f, 1f, 0.3f, 1f))
}

/** Translates (and scales) this content per [motion] while [focused], animated. Apply to a child of the focus target. */
@Composable
internal fun Modifier.mediaCardLift(focused: Boolean, motion: TvCardMotion = TvCardMotions.Card): Modifier {
    val progress by animateFloatAsState(
        targetValue = if (focused) 1f else 0f,
        animationSpec = tween(motion.durationMs, easing = motion.easing),
        label = "mediaCardLift",
    )
    return graphicsLayer {
        translationY = -motion.lift.toPx() * progress
        val s = 1f + (motion.scale - 1f) * progress
        scaleX = s
        scaleY = s
    }
}
