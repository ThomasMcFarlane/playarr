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
