package io.playarr.shared.designsystem.page

import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.unit.Dp
import io.playarr.shared.designsystem.theme.PlayarrWebTheme

/** The outline a focus ring follows. */
sealed interface PlayarrRingShape {
    data class Rounded(val radius: Dp) : PlayarrRingShape
    data object Round : PlayarrRingShape
    data object Ellipse : PlayarrRingShape
}

/**
 * The one focus ring (spec section 5, owner rulings Q2 and Q11): `--page-focus-ring` drawn outside the element, never a
 * fill. 3 dp offset 2 dp on television, 2 dp offset 3 dp on phones; white in the dark theme and the theme ink in the
 * light theme. The 1.06 / 1.1 focus scale is applied by the caller with `graphicsLayer`, so nothing around it moves.
 */
@Composable
fun Modifier.playarrFocusRing(shape: PlayarrRingShape): Modifier {
    val metrics = PlayarrPageTokens.current()
    val colour = PlayarrWebTheme.palette.focusRing
    return drawBehind {
        val width = metrics.focusRingWidth.toPx()
        // The stroke is centred on its path: push the path out by the offset plus half the width.
        val grow = metrics.focusRingOffset.toPx() + width / 2f
        val topLeft = Offset(-grow, -grow)
        val outer = Size(size.width + 2 * grow, size.height + 2 * grow)
        val stroke = Stroke(width = width)
        when (shape) {
            is PlayarrRingShape.Rounded -> drawRoundRect(colour, topLeft, outer, CornerRadius(shape.radius.toPx() + grow), style = stroke)
            PlayarrRingShape.Round -> drawRoundRect(colour, topLeft, outer, CornerRadius(minOf(outer.width, outer.height) / 2f), style = stroke)
            PlayarrRingShape.Ellipse -> drawOval(colour, topLeft, outer, style = stroke)
        }
    }
}
