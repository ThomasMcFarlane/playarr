package io.playarr.mobile.ui

import androidx.compose.ui.Modifier
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
 * The motion and shadow values live in core-designsystem (`PlayarrCardFocus.kt`), the card half of the focus token pair.
 */
