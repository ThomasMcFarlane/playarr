package io.playarr.shared.designsystem.page

import androidx.compose.foundation.BorderStroke
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.draw.drawBehind
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsFocusedAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.role
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.LocalMinimumInteractiveComponentSize
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Outline
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.SubcomposeLayout
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.unit.TextUnit
import io.playarr.shared.designsystem.theme.PlayarrWebTheme

/**
 * The text style the web phone layout uses (Chromium line-height leading and glyph positioning). The app provides it
 * once next to the font; the default is the plain Material style.
 */
val LocalPlayarrWebTextStyle = staticCompositionLocalOf { TextStyle.Default }

/** Where a header breadcrumb goes relative to the title. */
enum class PlayarrSubtitlePlacement { None, Inline, Wrapped }

/**
 * Pure placement rule: the breadcrumb stays on the title line only when it fits between the end of the
 * title block and the start of the clock's reserved area; otherwise it wraps beneath the title.
 */
fun decideSubtitlePlacement(
    hasSubtitle: Boolean,
    titleEndPx: Int,
    subtitleWidthPx: Int,
    separatorPx: Int,
    reservedStartPx: Int?,
): PlayarrSubtitlePlacement = when {
    !hasSubtitle -> PlayarrSubtitlePlacement.None
    reservedStartPx == null -> PlayarrSubtitlePlacement.Inline
    titleEndPx + separatorPx + subtitleWidthPx <= reservedStartPx -> PlayarrSubtitlePlacement.Inline
    else -> PlayarrSubtitlePlacement.Wrapped
}

/** Start of the shell clock's reserved area on television (the clock is drawn at 558.1 dp, top 68.2 dp, as web). */
val PlayarrClockReservedStart = 550.dp

/** CSS `border-radius: 50%` on a non-square box is an ellipse, not a pill. */
val PlayarrEllipseShape: Shape = object : Shape {
    override fun createOutline(size: Size, layoutDirection: LayoutDirection, density: androidx.compose.ui.unit.Density) =
        Outline.Generic(Path().apply { addOval(Rect(0f, 0f, size.width, size.height)) })
}

/**
 * Back + title + breadcrumb row. The title is truncated before the clock; the breadcrumb sits on the
 * title line behind a vertical divider when it fits before the clock, else wraps under the title behind a
 * horizontal rule, so it never renders beneath the clock/date.
 */
@Composable
internal fun PlayarrPageHeaderRow(
    spec: PlayarrPageHeaderSpec,
    modifier: Modifier = Modifier,
) {
    val tv = LocalPlayarrFormFactor.current == PlayarrFormFactor.Tv
    val metrics = PlayarrPageTokens.current()
    val palette = PlayarrWebTheme.palette
    val density = androidx.compose.ui.platform.LocalDensity.current
    val webText = LocalPlayarrWebTextStyle.current
    val title = spec.title
    // Web phone: the 21.6 px title used by Search, Settings and the detail pages (library headers use 17.6 px).
    val large = spec.largeTitle || spec.variant == PlayarrHeaderVariant.Detail
    val subtitle = spec.detail
    val reservedStartPx = if (tv) with(density) { (PlayarrClockReservedStart - metrics.start).roundToPx() } else null
    SubcomposeLayout(modifier) { constraints ->
        val loose = Constraints()
        val backSize = metrics.controlWidth.roundToPx()
        val backHeight = metrics.control.roundToPx()
        val gap = metrics.headerGap.roundToPx()
        val back = spec.back?.let { b ->
            subcompose("back") {
                if (tv) {
                    PlayarrRoundBackButton(b, spec.backActive)
                } else {
                    PlayarrPhoneBackPill(
                        onClick = b.onBack,
                        contentDescription = b.label,
                        active = spec.backActive,
                        focusScale = if (spec.backActive) 1.055f else 1f,
                    ) {
                        // Web draws the arrow as the text glyph "←" at 12.8 px, weight 720.
                        Text("←", color = if (spec.backActive) palette.background else palette.inkSoft, fontSize = 12.8.sp, fontWeight = FontWeight(720))
                    }
                }
            }.first().measure(Constraints.fixed(backSize, backHeight))
        }
        val backWidth = back?.width ?: 0
        val backGap = if (back != null) gap else 0
        val titleMax = ((reservedStartPx ?: constraints.maxWidth) - backWidth - backGap).coerceAtLeast(0)
        val titleP = subcompose("title") {
            Text(
                title,
                color = palette.ink,
                fontSize = if (tv) 34.sp else if (large) 21.6.sp else 17.6.sp,
                fontWeight = FontWeight(580),
                letterSpacing = if (tv) (-1.5).sp else if (large) (-0.972).sp else (-0.792).sp,
                lineHeight = if (tv) TextUnit.Unspecified else if (large) 32.4.sp else 26.4.sp,
                style = if (tv) androidx.compose.material3.LocalTextStyle.current else webText,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.semantics { heading() },
            )
        }.first().measure(loose.copy(maxWidth = titleMax.coerceAtMost(constraints.maxWidth)))
        val separator = (if (tv) 47.04.dp else 10.dp).roundToPx()
        val titleEnd = backWidth + backGap + titleP.width
        val probe = subtitle?.let {
            subcompose("probe") { PlayarrBreadcrumbText(it, phone = !tv) }.first().measure(loose)
        }
        val placement = decideSubtitlePlacement(subtitle != null, titleEnd, probe?.width ?: 0, separator, reservedStartPx)
        val inline = if (placement == PlayarrSubtitlePlacement.Inline) {
            subcompose("inline") {
                if (tv) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Box(Modifier.padding(horizontal = 23.04.dp).width(1.dp).height(metrics.control).background(palette.divider))
                        PlayarrBreadcrumbText(subtitle!!)
                    }
                } else {
                    // Web `.page-header-detail`: 1 px divider the full 38 px header height, 14 px padding, 10 px after the title.
                    Row(Modifier.height(metrics.control).padding(start = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                        Box(Modifier.width(1.dp).fillMaxHeight().background(palette.divider))
                        Spacer(Modifier.width(14.dp))
                        PlayarrBreadcrumbText(subtitle!!, phone = true)
                    }
                }
            }.first().measure(loose)
        } else {
            null
        }
        val wrapped = if (placement == PlayarrSubtitlePlacement.Wrapped) {
            subcompose("wrapped") {
                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Box(Modifier.fillMaxWidth().height(1.dp).background(palette.inkMuted.copy(alpha = 0.45f)))
                    PlayarrBreadcrumbText(subtitle!!, phone = !tv)
                }
            }.first().measure(loose.copy(maxWidth = (constraints.maxWidth - backWidth - backGap).coerceAtLeast(0).coerceAtMost((titleP.width + 160.dp.roundToPx()).coerceAtLeast(titleP.width))))
        } else {
            null
        }
        val backHeightPx = back?.height ?: 0
        val rowHeight = maxOf(backHeightPx, titleP.height)
        val width = maxOf(titleEnd + (inline?.width ?: 0), backWidth + backGap + (wrapped?.width ?: 0))
        val height = rowHeight + (wrapped?.let { it.height + 6.dp.roundToPx() } ?: 0)
        layout(width.coerceAtMost(constraints.maxWidth.coerceAtLeast(width)), height) {
            back?.placeRelative(0, (rowHeight - back.height) / 2)
            titleP.placeRelative(backWidth + backGap, (rowHeight - titleP.height) / 2)
            inline?.placeRelative(titleEnd, (rowHeight - inline.height) / 2)
            wrapped?.placeRelative(backWidth + backGap, rowHeight + 6.dp.roundToPx())
        }
    }
}

@Composable
private fun PlayarrBreadcrumbText(text: String, phone: Boolean = false) {
    Text(
        text,
        color = PlayarrWebTheme.palette.inkMuted,
        fontSize = if (phone) 8.sp else 11.136.sp,
        fontWeight = FontWeight(680),
        letterSpacing = if (phone) 0.36.sp else 0.501.sp,
        maxLines = 1,
        overflow = TextOverflow.Ellipsis,
    )
}

/** The phone Back control (web `.ui-btn--md`): an elliptical 42 x 38 pill, translucent border, 70% surface. */
@Composable
private fun PlayarrPhoneBackPill(
    onClick: () -> Unit,
    contentDescription: String,
    active: Boolean,
    focusScale: Float,
    content: @Composable () -> Unit,
) {
    val palette = PlayarrWebTheme.palette
    val metrics = PlayarrPageTokens.Phone
    val source = remember { MutableInteractionSource() }
    val focused by source.collectIsFocusedAsState()
    val scale = if (focused) maxOf(focusScale, 1.06f) else focusScale
    CompositionLocalProvider(LocalMinimumInteractiveComponentSize provides Dp.Unspecified) {
        Surface(
            onClick = onClick,
            interactionSource = source,
            modifier = Modifier.size(metrics.controlWidth, metrics.control).graphicsLayer { scaleX = scale; scaleY = scale }
                .then(if (focused || focusScale > 1f) Modifier.playarrFocusRing(PlayarrRingShape.Ellipse) else Modifier)
                .semantics { this.contentDescription = contentDescription },
            shape = PlayarrEllipseShape,
            color = if (active) palette.ink else palette.surfaceStrong.copy(alpha = 0.7f),
            contentColor = if (active) palette.background else palette.inkSoft,
            border = BorderStroke(1.dp, palette.pillBorder),
        ) {
            Box(contentAlignment = Alignment.Center) { content() }
        }
    }
}

/** The television Back button: a round ghost button that takes only the theme focus ring, never a fill (owner decision Q10). */
@Composable
private fun PlayarrRoundBackButton(back: PlayarrBack, active: Boolean) {
    val palette = PlayarrWebTheme.palette
    val metrics = PlayarrPageTokens.Tv
    val source = remember { MutableInteractionSource() }
    val focused by source.collectIsFocusedAsState()
    // Settings opens with the back button focused: web fills it with the ink colour, scales it 1.056 and draws the
    // 3 px ink outline 2 px outside it (`.ui-btn:focus-visible`).
    val scale = if (active) 1.056f else if (focused) 1.1f else 1f
    CompositionLocalProvider(LocalMinimumInteractiveComponentSize provides Dp.Unspecified) {
        Surface(
            onClick = back.onBack,
            interactionSource = source,
            shape = CircleShape,
            // Web `a.ui-btn--icon`: rgba(33,29,33,.7) fill with a 1px ring and a text arrow.
            color = if (active) palette.ink else palette.surfaceStrong.copy(alpha = 0.7f),
            contentColor = if (active) palette.background else palette.inkSoft,
            border = if (active) null else BorderStroke(1.dp, palette.pillBorder),
            modifier = Modifier
                .size(metrics.controlWidth, metrics.control)
                .then(
                    if (active) Modifier.drawBehind {
                        drawCircle(palette.ink, radius = 29.9.dp.toPx(), style = Stroke(3.dp.toPx()))
                    } else Modifier,
                )
                .graphicsLayer { scaleX = scale; scaleY = scale }
                .then(if (focused && !active) Modifier.playarrFocusRing(PlayarrRingShape.Round) else Modifier)
                .semantics { contentDescription = back.label; role = Role.Button },
        ) {
            Box(contentAlignment = Alignment.Center) {
                Text("\u2190", fontSize = 17.28.sp, fontWeight = FontWeight(720))
            }
        }
    }
}
