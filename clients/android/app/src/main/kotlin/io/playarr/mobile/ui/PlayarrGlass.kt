package io.playarr.mobile.ui

import android.graphics.Bitmap
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.Stable
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.graphics.ColorMatrix
import androidx.compose.ui.graphics.FilterQuality
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.drawscope.scale
import androidx.compose.ui.graphics.drawscope.translate
import androidx.compose.ui.graphics.layer.drawLayer
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.positionInRoot
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalGraphicsContext
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.FlowPreview
import kotlinx.coroutines.channels.BufferOverflow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.debounce
import kotlinx.coroutines.withContext
import kotlin.math.roundToInt

/*
 * Native "frosted glass" for the Playarr TV and phone shells.
 *
 * Playarr Web gets its glass from `backdrop-filter: blur(Npx) saturate(S)`.
 * Compose cannot sample what sits behind a composable, so the hero backdrop
 * (key art + scrim, see [HeroBackdropStack]) is snapshotted once per backdrop
 * change into a tiny (1/8 scale) bitmap, box-blurred on the CPU and cached in
 * [GlassBackdrop]. Every glass surface then draws that cached bitmap, clipped
 * to its own bounds and offset to line up with the page, followed by the web
 * tint, hairline border and shadow. Per frame this is one bilinear texture
 * draw per panel: no RenderEffect, no per-frame blur, works on API 26+.
 */

/** Web tokens recorded from `global.css` (dark / light), see DESIGN.md for the glass table. */
internal object WebGlass {
    /** `.app-nav-group`: blur(24px) saturate(1.2), surface-strong @ .56, 22px radius, hairline border, shadow 0 14 42. */
    val NavGroup = GlassSpec(saturation = 1.2f, tintAlpha = 0.56f, borderAlphaDark = 0.053f, borderAlphaLight = 0.068f, shadow = 14.dp)

    /** Phone `.app-nav`: no blur, surface-strong @ .88, no border, shadow 0 14 40. */
    val PhoneNav = GlassSpec(saturation = 1.0f, tintAlpha = 0.88f, borderAlphaDark = 0f, borderAlphaLight = 0f, shadow = 14.dp)

    /** `.app-user-identity`: blur(22px) saturate(1.2), surface-strong @ .66, shadow 0 18 48. */
    val Identity = GlassSpec(saturation = 1.2f, tintAlpha = 0.66f, borderAlphaDark = 0.077f, borderAlphaLight = 0.099f, shadow = 18.dp)

    /** `.tv-page-back` and small round controls: blur(18px), surface-strong @ .70. */
    val Control = GlassSpec(saturation = 1.0f, tintAlpha = 0.70f, borderAlphaDark = 0.077f, borderAlphaLight = 0.099f, shadow = 0.dp)

    /** `.tv-rail-panel` / drawers / mini player: blur(16-30px) saturate(1.12-1.16), surface-strong @ .72-.76. */
    val Panel = GlassSpec(saturation = 1.16f, tintAlpha = 0.74f, borderAlphaDark = 0.10f, borderAlphaLight = 0.12f, shadow = 20.dp)

    /** Web box-shadow colour `rgba(56, 38, 33, .1)`. */
    val ShadowColor = Color(0x1A382621)

    /** Blur sigma shared by every panel (nav 24px, identity 22px, controls 18px on the web). */
    val BlurSigma = 22.dp

    /** Key art `.tv-key-art img` filter and opacity per theme. */
    const val ART_CONTRAST_DARK = 0.82f
    const val ART_BRIGHTNESS_DARK = 0.60f
    const val ART_OPACITY_DARK = 0.72f
    const val ART_CONTRAST_LIGHT = 0.88f
    const val ART_BRIGHTNESS_LIGHT = 1.10f
    const val ART_OPACITY_LIGHT = 0.40f
}

@Stable
internal class GlassSpec(
    val saturation: Float,
    val tintAlpha: Float,
    val borderAlphaDark: Float,
    val borderAlphaLight: Float,
    val shadow: Dp,
)

/** Downscale factor of the cached backdrop snapshot; blur radius shrinks with it. */
internal const val GLASS_SNAPSHOT_SCALE = 8

/**
 * Box radius (in snapshot pixels) whose three-pass blur approximates a Gaussian
 * of [sigmaPx] device pixels once the page is downscaled by [scale].
 */
internal fun glassBoxRadius(sigmaPx: Float, scale: Int = GLASS_SNAPSHOT_SCALE): Int =
    (sigmaPx / scale - 0.5f).roundToInt().coerceAtLeast(1)

/** Three-pass separable box blur over ARGB_8888 (premultiplied) [pixels], clamped at the edges. */
internal fun boxBlurArgb(pixels: IntArray, width: Int, height: Int, radius: Int): IntArray {
    val src = pixels.copyOf()
    val dst = IntArray(pixels.size)
    repeat(3) {
        blurPass(src, dst, width, height, radius, horizontal = true)
        blurPass(dst, src, width, height, radius, horizontal = false)
    }
    return src
}

private fun blurPass(src: IntArray, dst: IntArray, w: Int, h: Int, r: Int, horizontal: Boolean) {
    val lines = if (horizontal) h else w
    val len = if (horizontal) w else h
    val window = 2 * r + 1
    for (line in 0 until lines) {
        fun at(i: Int): Int {
            val c = i.coerceIn(0, len - 1)
            return if (horizontal) src[line * w + c] else src[c * w + line]
        }
        var a = 0
        var red = 0
        var green = 0
        var blue = 0
        for (i in -r..r) {
            val p = at(i)
            a += p ushr 24
            red += (p shr 16) and 0xFF
            green += (p shr 8) and 0xFF
            blue += p and 0xFF
        }
        for (i in 0 until len) {
            val out = ((a / window) shl 24) or ((red / window) shl 16) or ((green / window) shl 8) or (blue / window)
            if (horizontal) dst[line * w + i] = out else dst[i * w + line] = out
            val add = at(i + r + 1)
            val sub = at(i - r)
            a += (add ushr 24) - (sub ushr 24)
            red += ((add shr 16) and 0xFF) - ((sub shr 16) and 0xFF)
            green += ((add shr 8) and 0xFF) - ((sub shr 8) and 0xFF)
            blue += (add and 0xFF) - (sub and 0xFF)
        }
    }
}

/** Cached, pre-blurred low-resolution copy of the current hero backdrop. */
@Stable
internal class GlassBackdrop {
    /** Blurred snapshot, or null while no hero backdrop is on screen (glass then shows only its tint). */
    var blurred by mutableStateOf<ImageBitmap?>(null)

    /** Window position and full-resolution size the snapshot was taken at. */
    var origin by mutableStateOf(Offset.Zero)
    var size by mutableStateOf(IntSize.Zero)

    /** Identity of the source that owns [blurred], so a departing page never clears its successor's snapshot. */
    internal var owner: Any? = null
}

internal val LocalGlassBackdrop = compositionLocalOf<GlassBackdrop?> { null }

@Composable
internal fun rememberGlassBackdrop(): GlassBackdrop = remember { GlassBackdrop() }

/**
 * Wraps a screen's hero art + scrim so glass surfaces can sample it. Layout is
 * identical to a plain full-size [Box]; the snapshot is retaken (debounced)
 * only when the backdrop's own drawing changes, never for rail scrolling.
 */
@Composable
internal fun HeroBackdropStack(content: @Composable BoxScope.() -> Unit) {
    Box(Modifier.fillMaxSize().glassBackdropSource(), content = content)
}

@OptIn(FlowPreview::class)
@Composable
private fun Modifier.glassBackdropSource(): Modifier {
    val backdrop = LocalGlassBackdrop.current ?: return this
    val context = LocalGraphicsContext.current
    val density = LocalDensity.current
    val owner = remember { Any() }
    val layer = remember(context) { context.createGraphicsLayer() }
    val small = remember(context) { context.createGraphicsLayer() }
    val changed = remember { MutableSharedFlow<IntSize>(extraBufferCapacity = 1, onBufferOverflow = BufferOverflow.DROP_OLDEST) }
    var position by remember { mutableStateOf(Offset.Zero) }

    DisposableEffect(layer, small) {
        onDispose {
            context.releaseGraphicsLayer(layer)
            context.releaseGraphicsLayer(small)
            if (backdrop.owner === owner) {
                backdrop.blurred = null
                backdrop.owner = null
            }
        }
    }
    LaunchedEffect(layer, density) {
        changed.debounce(120).collectLatest { fullSize ->
            if (fullSize.width <= 0 || fullSize.height <= 0) return@collectLatest
            val w = (fullSize.width / GLASS_SNAPSHOT_SCALE).coerceAtLeast(1)
            val h = (fullSize.height / GLASS_SNAPSHOT_SCALE).coerceAtLeast(1)
            small.record(density, LayoutDirection.Ltr, IntSize(w, h)) {
                scale(1f / GLASS_SNAPSHOT_SCALE, pivot = Offset.Zero) { drawLayer(layer) }
            }
            val bitmap = small.toImageBitmap().asAndroidBitmap().copy(Bitmap.Config.ARGB_8888, false) ?: return@collectLatest
            val sigmaPx = with(density) { WebGlass.BlurSigma.toPx() }
            val blurred = withContext(Dispatchers.Default) {
                val px = IntArray(bitmap.width * bitmap.height)
                bitmap.getPixels(px, 0, bitmap.width, 0, 0, bitmap.width, bitmap.height)
                val out = boxBlurArgb(px, bitmap.width, bitmap.height, glassBoxRadius(sigmaPx))
                Bitmap.createBitmap(out, bitmap.width, bitmap.height, Bitmap.Config.ARGB_8888)
            }
            backdrop.origin = position
            backdrop.size = fullSize
            backdrop.blurred = blurred.asImageBitmap()
            backdrop.owner = owner
        }
    }
    return this
        .onGloballyPositioned { position = it.positionInRoot() }
        .drawWithContent {
            layer.record { this@drawWithContent.drawContent() }
            drawLayer(layer)
            changed.tryEmit(IntSize(size.width.roundToInt(), size.height.roundToInt()))
        }
}

private fun saturationFilter(saturation: Float): ColorFilter? =
    if (saturation == 1f) null else ColorFilter.colorMatrix(ColorMatrix().apply { setToSaturation(saturation) })

/**
 * Frosted-glass surface: shadow, cached blurred backdrop clipped to [shape],
 * web tint and hairline border. Apply before padding/children as with
 * [Modifier.background]. With no hero backdrop on screen it is just the tint
 * over the flat page surface, exactly like the web with nothing behind it.
 */
@Composable
internal fun Modifier.glass(shape: Shape, spec: GlassSpec, dark: Boolean = webIsDark, tint: Color = WebSurfaceStrong): Modifier {
    val backdrop = LocalGlassBackdrop.current
    var position by remember { mutableStateOf(Offset.Zero) }
    val satFilter = remember(spec) { saturationFilter(spec.saturation) }
    val tintColor = tint.copy(alpha = spec.tintAlpha)
    val borderAlpha = if (dark) spec.borderAlphaDark else spec.borderAlphaLight
    val borderColor = (if (dark) Color(0xFFDFDCDD) else Color(0xFF382621)).copy(alpha = borderAlpha)
    return this
        .onGloballyPositioned { position = it.positionInRoot() }
        .then(
            if (spec.shadow > 0.dp) {
                Modifier.shadow(spec.shadow, shape, clip = false, ambientColor = WebGlass.ShadowColor, spotColor = WebGlass.ShadowColor)
            } else {
                Modifier
            },
        )
        .clip(shape)
        .drawBehind {
            val image = backdrop?.blurred
            if (image != null && backdrop.size != IntSize.Zero) {
                val offset = position - backdrop.origin
                translate(-offset.x, -offset.y) {
                    drawImage(
                        image = image,
                        srcSize = IntSize(image.width, image.height),
                        dstSize = backdrop.size,
                        colorFilter = satFilter,
                        filterQuality = FilterQuality.Low,
                    )
                }
            }
            drawRect(tintColor)
        }
        .border(BorderStroke(1.dp, borderColor), shape)
}

/* ---- Key art treatment: `.tv-key-art img` { grayscale(1) contrast(c) brightness(b); opacity } ---- */

private const val LUMA_R = 0.2126f
private const val LUMA_G = 0.7152f
private const val LUMA_B = 0.0722f

/** Value of a grey pixel [gray] (0..1) after grayscale, contrast and brightness (CSS filter order). */
internal fun heroArtFilteredGray(gray: Float, contrast: Float, brightness: Float): Float =
    (brightness * (contrast * (gray - 0.5f) + 0.5f)).coerceIn(0f, 1f)

/** 4x5 Android colour matrix equivalent of `grayscale(1) contrast(c) brightness(b)`. */
internal fun heroArtMatrix(contrast: Float, brightness: Float, exposureGain: Float = 1f): FloatArray {
    val k = contrast * brightness * exposureGain
    val offset = brightness * 0.5f * (1f - contrast) * 255f
    val row = floatArrayOf(k * LUMA_R, k * LUMA_G, k * LUMA_B, 0f, offset)
    return floatArrayOf(
        *row,
        *row,
        *row,
        0f, 0f, 0f, 1f, 0f,
    )
}

internal val heroArtFilterDark: ColorFilter =
    ColorFilter.colorMatrix(ColorMatrix(heroArtMatrix(WebGlass.ART_CONTRAST_DARK, WebGlass.ART_BRIGHTNESS_DARK)))
internal val heroArtFilterLight: ColorFilter =
    ColorFilter.colorMatrix(ColorMatrix(heroArtMatrix(WebGlass.ART_CONTRAST_LIGHT, WebGlass.ART_BRIGHTNESS_LIGHT)))

internal fun heroArtFilter(dark: Boolean, exposureGain: Float = 1f): ColorFilter = when {
    exposureGain <= 1f -> if (dark) heroArtFilterDark else heroArtFilterLight
    dark -> ColorFilter.colorMatrix(ColorMatrix(heroArtMatrix(WebGlass.ART_CONTRAST_DARK, WebGlass.ART_BRIGHTNESS_DARK, exposureGain)))
    else -> ColorFilter.colorMatrix(ColorMatrix(heroArtMatrix(WebGlass.ART_CONTRAST_LIGHT, WebGlass.ART_BRIGHTNESS_LIGHT, exposureGain)))
}

/** Mean luminance (0..1) at or below which key art is treated as near-black (Sample Movie Four backdrop is ~9/255 = 0.035). */
internal const val HERO_ART_DIM_LUMA = 0.12f
private const val HERO_ART_TARGET_LUMA = 0.22f
private const val HERO_ART_MAX_GAIN = 6f

/** Mean Rec.709 luminance (0..1) of packed ARGB [pixels]; 0 for an empty sample. */
internal fun heroArtMeanLuma(pixels: IntArray): Float {
    if (pixels.isEmpty()) return 0f
    var sum = 0.0
    for (p in pixels) {
        sum += LUMA_R * ((p shr 16) and 0xFF) + LUMA_G * ((p shr 8) and 0xFF) + LUMA_B * (p and 0xFF)
    }
    return (sum / pixels.size / 255.0).toFloat()
}

/**
 * Exposure multiplier applied before the key-art filter so near-black art (mean luminance
 * <= [HERO_ART_DIM_LUMA]) is lifted towards a visible level instead of leaving the hero empty.
 * Art at or above the threshold is untouched (1f).
 */
internal fun heroArtExposureGain(meanLuma: Float): Float =
    if (meanLuma > HERO_ART_DIM_LUMA) 1f else (HERO_ART_TARGET_LUMA / meanLuma.coerceAtLeast(0.001f)).coerceIn(1f, HERO_ART_MAX_GAIN)
internal fun heroArtOpacity(dark: Boolean): Float = if (dark) WebGlass.ART_OPACITY_DARK else WebGlass.ART_OPACITY_LIGHT

/**
 * Index of the first candidate of the next non-empty artwork kind after [current], given the candidate
 * count of each requested kind in order, or null when the current candidate is already in the last kind.
 */
internal fun playarrDimArtFallbackIndex(groupSizes: List<Int>, current: Int): Int? {
    var start = 0
    for (size in groupSizes) {
        if (size == 0) continue
        val end = start + size
        if (current < end) return if (end < groupSizes.sum()) end else null
        start = end
    }
    return null
}
