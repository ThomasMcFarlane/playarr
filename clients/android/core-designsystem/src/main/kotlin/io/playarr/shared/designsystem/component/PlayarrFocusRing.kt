package io.playarr.shared.designsystem.component

import androidx.compose.foundation.IndicationNodeFactory
import androidx.compose.foundation.interaction.InteractionSource
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.drawscope.ContentDrawScope
import androidx.compose.ui.node.DelegatableNode
import androidx.compose.ui.node.DrawModifierNode
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import kotlin.math.min

/** Web ring width at the 1920 px television canvas (`outline: 3px solid var(--focus-outline)`). */
val PlayarrFocusRingWidth: Dp = 3.dp

/**
 * The one Playarr focus indicator, matching the web client: a ring drawn outside the element and no change to
 * its fill. [radius] is the element's corner radius (null for a pill or circle); [offset] is the gap between the
 * element and the ring (web `outline-offset`). Nothing is drawn while not [focused].
 */
fun Modifier.playarrFocusRing(
    focused: Boolean,
    color: Color,
    radius: Dp? = null,
    offset: Dp = 0.dp,
    width: Dp = PlayarrFocusRingWidth,
): Modifier = if (!focused) {
    this
} else {
    drawWithContent {
        drawContent()
        val stroke = width.toPx()
        val grow = offset.toPx() + stroke / 2f
        val w = size.width + grow * 2f
        val h = size.height + grow * 2f
        val corner = if (radius == null) min(w, h) / 2f else maxOf(0f, radius.toPx() + grow)
        drawRoundRect(
            color = color,
            topLeft = Offset(-grow, -grow),
            size = Size(w, h),
            cornerRadius = CornerRadius(corner, corner),
            style = Stroke(stroke),
        )
    }
}

/** The colour of the focus ring (web `--focus-outline`); the app provides its palette token, white is the fallback. */
val LocalPlayarrFocusRing = staticCompositionLocalOf { Color.White }

/**
 * Television shows focus as a ring and never as a state-layer fill, so clickable surfaces there draw no Material
 * indication at all (the default indication paints a translucent rectangle over a focused card or row).
 */
object PlayarrNoIndication : IndicationNodeFactory {
    override fun create(interactionSource: InteractionSource): DelegatableNode = object : Modifier.Node(), DrawModifierNode {
        override fun ContentDrawScope.draw() = drawContent()
    }

    override fun hashCode(): Int = -1

    override fun equals(other: Any?): Boolean = other === this
}
