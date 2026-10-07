package io.playarr.mobile.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.runtime.Composable
import androidx.compose.ui.BiasAlignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.graphics.BlendMode
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.CompositingStrategy
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import io.playarr.shared.data.model.ImageKind
import io.playarr.shared.data.model.Work

/*
 * The web mobile page background, layer for layer (`.tv-key-art`, `.tv-key-art::after`, `.tv-stage-wash` and the
 * page's `.tv-rail-surface` panel in global.css under the phone media query). The art itself is the selected
 * title's backdrop: top 55% of the key-art box, scaled 1.04, grayscale and dimmed, faded out towards the right;
 * two surface gradients then hide most of it. Everything is tinted with the active theme's surface colour.
 */

/** `.tv-key-art`: art plus the `::after` gradients, filling [modifier]'s box. */
@Composable
internal fun PhoneKeyArt(
    work: Work?,
    serverUrl: String,
    accessToken: String?,
    modifier: Modifier = Modifier,
) {
    val surface = WebSurface
    val clear = surface.copy(alpha = 0f)
    BoxWithConstraints(modifier.clipToBounds()) {
        val boxHeight = maxHeight
        if (work != null) {
            AuthenticatedArtwork(
                work = work,
                kinds = listOf(ImageKind.Backdrop, ImageKind.Poster),
                serverUrl = serverUrl,
                accessToken = accessToken,
                contentScale = ContentScale.Crop,
                modifier = Modifier
                    .fillMaxWidth()
                    .height(boxHeight * 0.55f)
                    .graphicsLayer {
                        scaleX = 1.04f
                        scaleY = 1.04f
                        compositingStrategy = CompositingStrategy.Offscreen
                    }
                    .drawWithContent {
                        drawContent()
                        // mask-image: linear-gradient(90deg, #000 0%, #000 72%, transparent 100%)
                        drawRect(
                            brush = Brush.horizontalGradient(0f to Color.Black, 0.72f to Color.Black, 1f to Color.Transparent),
                            blendMode = BlendMode.DstIn,
                        )
                    },
                heroStyle = true,
                artAlpha = if (webIsDark) 0.72f else 0.42f,
                artAlignment = BiasAlignment(0f, -0.56f), // object-position: center 22%
            )
        }
        // linear-gradient(90deg, surface 54%, transparent) sits beneath linear-gradient(0deg, surface 46%, transparent 74%).
        Box(Modifier.matchParentSize().background(Brush.horizontalGradient(0f to surface.copy(alpha = 0.54f), 1f to clear)))
        Box(
            Modifier.matchParentSize().background(
                Brush.verticalGradient(0f to clear, 0.26f to clear, 0.54f to surface, 1f to surface),
            ),
        )
    }
}

/** `.tv-stage-wash`: `linear-gradient(0deg, surface 34%, transparent 68%)`. */
@Composable
internal fun PhoneStageWash(modifier: Modifier = Modifier) {
    val surface = WebSurface
    val clear = surface.copy(alpha = 0f)
    Box(modifier.background(Brush.verticalGradient(0f to clear, 0.32f to clear, 0.66f to surface, 1f to surface)))
}

/** Home's `.tv-rail-surface`: transparent at its top edge, solid surface from 8% down. */
@Composable
internal fun phoneHomePanelBrush(): Brush {
    val surface = WebSurface
    return Brush.verticalGradient(0f to surface.copy(alpha = 0f), 0.08f to surface, 1f to surface)
}

/**
 * Library, search and detail `.tv-rail-panel`: a solid 96% surface in the light theme, the sideways frost
 * gradient in the dark theme. [fadeFraction] (search and detail light theme) fades it in from the top instead.
 */
@Composable
internal fun phonePanelBrush(fadeFraction: Float? = null): Brush {
    val surface = WebSurface
    return if (webIsDark) {
        webRailSurfaceBrush()
    } else if (fadeFraction != null) {
        Brush.verticalGradient(0f to surface.copy(alpha = 0f), fadeFraction to surface, 1f to surface)
    } else {
        Brush.verticalGradient(0f to surface.copy(alpha = 0.96f), 1f to surface.copy(alpha = 0.96f))
    }
}

/** One CSS `box-shadow` layer: no spread, [dy] vertical offset, [blur] the CSS blur radius (Gaussian sigma = blur / 2). */
internal class WebShadow(val dy: Dp, val blur: Dp, val color: Color)

internal val WarmShadow = Color(0xFF382621)
private val RoseShadow = Color(0xFF1F0E14)

/** `.tv-home-card-art`, `.tv-title-card-art` and `.tv-search-result-art` shadows (the same in both themes). */
internal fun webCardShadows(selected: Boolean, home: Boolean, search: Boolean): List<WebShadow> = when {
    search -> if (selected) listOf(WebShadow(22.dp, 52.dp, RoseShadow.copy(alpha = 0.28f)))
    else listOf(WebShadow(12.dp, 34.dp, RoseShadow.copy(alpha = 0.16f)))
    home -> if (selected) listOf(WebShadow(26.dp, 52.dp, WarmShadow.copy(alpha = 0.32f)), WebShadow(11.dp, 22.dp, WarmShadow.copy(alpha = 0.22f)))
    else listOf(WebShadow(10.dp, 22.dp, WarmShadow.copy(alpha = 0.16f)), WebShadow(3.dp, 9.dp, WarmShadow.copy(alpha = 0.10f)))
    else -> if (selected) listOf(WebShadow(24.dp, 48.dp, WarmShadow.copy(alpha = 0.30f)), WebShadow(10.dp, 20.dp, WarmShadow.copy(alpha = 0.20f)))
    else listOf(WebShadow(10.dp, 20.dp, WarmShadow.copy(alpha = 0.14f)), WebShadow(3.dp, 8.dp, WarmShadow.copy(alpha = 0.10f)))
}

/** Remote-mode focused card art (`body[data-input-mode="remote"] .tv-home-card[data-remote-active] ...`): a deeper pair of shadows. */
internal val webRemoteFocusShadows: List<WebShadow> get() =
    listOf(WebShadow(26.dp, 52.dp, WarmShadow.copy(alpha = 0.32f)), WebShadow(11.dp, 22.dp, WarmShadow.copy(alpha = 0.22f)))

/** Focused art shadow of cards other than Home and Search: `0 24px 48px .30, 0 10px 20px .20`. */
internal val webCardFocusShadows: List<WebShadow> get() =
    listOf(WebShadow(24.dp, 48.dp, WarmShadow.copy(alpha = 0.30f)), WebShadow(10.dp, 20.dp, WarmShadow.copy(alpha = 0.20f)))

/** Focused search result art: `0 22px 52px rgba(31,14,20,.28)`. */
internal val webSearchFocusShadows: List<WebShadow> get() =
    listOf(WebShadow(22.dp, 52.dp, Color(0xFF1F0E14).copy(alpha = 0.28f)))

/** Resting card art shadow: `0 10px 20px .14, 0 3px 8px .10`. */
internal val webCardRestShadows: List<WebShadow> get() =
    listOf(WebShadow(10.dp, 20.dp, WarmShadow.copy(alpha = 0.14f)), WebShadow(3.dp, 8.dp, WarmShadow.copy(alpha = 0.10f)))

/**
 * A box with CSS-style blurred drop shadows behind it, clipped content in front. The blur is a RenderEffect (API 31+);
 * older devices draw no shadow rather than a hard-edged one.
 */
@Composable
internal fun WebShadowedBox(
    shadows: List<WebShadow>,
    shape: androidx.compose.ui.graphics.Shape,
    modifier: Modifier = Modifier,
    innerModifier: Modifier = Modifier,
    /** False sizes the box to its content (the shadow layers still follow it). */
    innerFill: Boolean = true,
    innerWidthFill: Boolean = false,
    content: @Composable androidx.compose.foundation.layout.BoxScope.() -> Unit,
) {
    Box(modifier) {
        if (android.os.Build.VERSION.SDK_INT >= 31) {
            shadows.forEach { shadow ->
                Box(
                    Modifier.matchParentSize().graphicsLayer {
                        translationY = shadow.dy.toPx()
                        val sigma = shadow.blur.toPx() / 2f
                        renderEffect = androidx.compose.ui.graphics.BlurEffect(sigma, sigma, androidx.compose.ui.graphics.TileMode.Decal)
                    }.background(shadow.color, shape),
                )
            }
        }
        Box((if (innerFill) Modifier.matchParentSize() else if (innerWidthFill) Modifier.fillMaxWidth() else Modifier).clip(shape).then(innerModifier), content = content)
    }
}

/**
 * Web phone action pill (`.tv-detail-download`, `.tv-detail-playback-settings`, `.tv-detail-play`): 44 px tall, fully rounded,
 * a drop shadow, content centred. [width] null sizes to the content (minimum 104).
 */
@Composable
internal fun PhonePill(
    onClick: () -> Unit,
    container: Color,
    modifier: Modifier = Modifier,
    width: Dp? = null,
    shadow: WebShadow = WebShadow(14.dp, 38.dp, Color(0xFF382621).copy(alpha = 0.12f)),
    enabled: Boolean = true,
    /** Fill the width the parent gives (a weighted pill in a row). */
    fill: Boolean = false,
    content: @Composable androidx.compose.foundation.layout.RowScope.() -> Unit,
) {
    WebShadowedBox(
        shadows = listOf(shadow),
        shape = androidx.compose.foundation.shape.CircleShape,
        modifier = modifier,
        innerModifier = Modifier.background(container),
        innerFill = false,
        innerWidthFill = fill,
    ) {
        androidx.compose.foundation.layout.Row(
            Modifier.height(44.dp).then(if (fill) Modifier.fillMaxWidth() else if (width != null) Modifier.width(width) else Modifier.widthIn(min = 104.dp))
                .clickable(enabled = enabled, onClick = onClick).padding(horizontal = 16.dp),
            verticalAlignment = androidx.compose.ui.Alignment.CenterVertically,
            horizontalArrangement = androidx.compose.foundation.layout.Arrangement.Center,
            content = content,
        )
    }
}

private val EpisodeArtGrayscale = androidx.compose.ui.graphics.ColorFilter.colorMatrix(
    androidx.compose.ui.graphics.ColorMatrix().apply { setToSaturation(0.75f) },
)

/**
 * Web phone `.tv-episode-art`: a 16:9 tile with 8 px corners and two soft shadows, its picture at `grayscale(.25)` under a
 * `linear-gradient(135deg, rgba(0,0,0,.05), rgba(0,0,0,.48))`, and a badge slot on top.
 */
@Composable
internal fun PhoneEpisodeArt(
    modifier: Modifier = Modifier,
    badge: @Composable androidx.compose.foundation.layout.BoxScope.() -> Unit = {},
    art: @Composable androidx.compose.foundation.layout.BoxScope.() -> Unit,
) {
    WebShadowedBox(
        shadows = listOf(WebShadow(10.dp, 20.dp, WarmShadow.copy(alpha = 0.14f)), WebShadow(3.dp, 8.dp, WarmShadow.copy(alpha = 0.10f))),
        shape = androidx.compose.foundation.shape.RoundedCornerShape(8.dp),
        modifier = modifier.fillMaxWidth().androidx_aspect16x9(),
        innerModifier = Modifier.background(WebSurfaceSoft),
    ) {
        Box(
            Modifier.fillMaxSize().graphicsLayer {
                compositingStrategy = CompositingStrategy.Offscreen
                colorFilter = EpisodeArtGrayscale
            },
            content = art,
        )
        Box(
            Modifier.fillMaxSize().drawWithContent {
                drawContent()
                // CSS 135deg: the gradient line runs corner to corner at 45 degrees, (w + h) / sqrt(2) long.
                val half = (size.width + size.height) / 2f * 0.70710678f
                val c = androidx.compose.ui.geometry.Offset(size.width / 2f, size.height / 2f)
                val d = androidx.compose.ui.geometry.Offset(0.70710678f, 0.70710678f)
                drawRect(
                    Brush.linearGradient(
                        listOf(Color.Black.copy(alpha = 0.05f), Color.Black.copy(alpha = 0.48f)),
                        start = c - d * half,
                        end = c + d * half,
                    ),
                )
            },
        )
        badge()
    }
}

private fun Modifier.androidx_aspect16x9(): Modifier = this.then(Modifier.aspectRatio(16f / 9f))
