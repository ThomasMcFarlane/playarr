package io.playarr.shared.designsystem.page

import android.os.Build
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.BlurEffect
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.TileMode
import androidx.compose.ui.layout.Layout
import androidx.compose.ui.layout.layout
import androidx.compose.ui.unit.Constraints

/**
 * Content with CSS-style blurred drop shadows behind it (`box-shadow: 0 <dy> <blur> <colour>`, no spread). The blur is a
 * RenderEffect (API 31 and up; older devices draw no shadow rather than a hard-edged one), and each layer is grown by its
 * blur radius so the shadow spreads past the content as a CSS box-shadow does.
 */
@Composable
fun PlayarrBlurShadow(
    shadows: List<PlayarrCardShadowLayer>,
    shape: Shape,
    modifier: Modifier = Modifier,
    content: @Composable () -> Unit,
) {
    val draw = Build.VERSION.SDK_INT >= 31
    Layout(
        content = {
            if (draw) shadows.forEach { shadow -> ShadowLayer(shadow, shape) }
            content()
        },
        modifier = modifier,
    ) { measurables, constraints ->
        val count = if (draw) shadows.size else 0
        val body = measurables.last().measure(constraints)
        val layers = measurables.take(count).map { it.measure(Constraints.fixed(body.width, body.height)) }
        layout(body.width, body.height) {
            layers.forEach { it.place(0, 0) }
            body.place(0, 0)
        }
    }
}

@Composable
private fun ShadowLayer(shadow: PlayarrCardShadowLayer, shape: Shape) {
    Box(
        Modifier.layout { measurable, constraints ->
            val grow = shadow.blur.roundToPx()
            val placeable = measurable.measure(Constraints.fixed(constraints.maxWidth + 2 * grow, constraints.maxHeight + 2 * grow))
            layout(constraints.maxWidth, constraints.maxHeight) {
                placeable.placeWithLayer(-grow, -grow) {
                    translationY = shadow.offsetY.toPx()
                    val sigma = shadow.blur.toPx() / 2f
                    renderEffect = BlurEffect(sigma, sigma, TileMode.Decal)
                }
            }
        },
    ) {
        Box(Modifier.fillMaxSize().padding(shadow.blur).background(shadow.color, shape))
    }
}
