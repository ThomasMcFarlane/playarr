package io.playarr.shared.designsystem.page

import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/** The two page layouts: the 1920 x 1080 television layout and the phone layout. */
enum class PlayarrFormFactor { Tv, Phone }

/** Provided once, in `MainActivity`. */
val LocalPlayarrFormFactor = staticCompositionLocalOf { PlayarrFormFactor.Phone }

/**
 * Page chrome measurements (docs/design/page-layout.md section 3). One CSS px is one dp on the television reference.
 * Every page reads its gutters, header geometry and safe areas from here, so no screen carries a literal.
 */
@Immutable
data class PlayarrPageMetrics(
    /** `--page-header-top`: top of the header row (phone: plus the system insets). */
    val headerTop: Dp,
    /** `--page-start`: left edge of page content. TV clears the 118 dp navigation rail. */
    val start: Dp,
    /** `--page-end` for the header row (phone: clear of the profile avatar). */
    val headerEnd: Dp,
    /** `--page-end` for the body. */
    val bodyEnd: Dp,
    /** `--page-control-height`: Back, icon buttons and the clock. */
    val control: Dp,
    /** Width of Back and the period arrows. */
    val controlWidth: Dp,
    /** `--action-pill-width`. */
    val pillWidth: Dp,
    /** `--action-pill-height`. */
    val pillHeight: Dp,
    /** `--action-pill-radius`. */
    val pillRadius: Dp,
    /** `--page-header-gap`: between Back and the title. */
    val headerGap: Dp,
    /** `--page-actions-gap`: between header actions. */
    val actionsGap: Dp,
    /** `--page-header-divider-pad`: either side of the title and detail divider. */
    val dividerPad: Dp,
    /** `--page-body-top` for a panel body. */
    val bodyTop: Dp,
    /** `--page-safe-bottom`: the body never draws under the profile chip. */
    val safeBottom: Dp,
    /** `--page-focus-ring` width. */
    val focusRingWidth: Dp,
    /** `--page-focus-ring` offset. */
    val focusRingOffset: Dp,
    /** `--shell-action-column-top`: top of the shell action column (television only; phones keep the header row). */
    val shellColumnTop: Dp,
    /** `--directory-controls-edge`: gap from the right screen edge to the shell action column. */
    val shellColumnEdge: Dp,
    /** Vertical gap between stacked tiles in the shell action column (`.page-header-stack`). */
    val shellColumnGap: Dp,
) {
    /** `--page-header-height`: the row grows to the tile (owner ruling Q9). */
    val headerHeight: Dp get() = if (pillHeight > control) pillHeight else control
}

/** The edge fade (`--page-edge-fade`): the web rail-panel glow, with the stronger scrim in the dark theme. */
object PlayarrEdgeFadeTokens {
    /** Light: opacity of the radial shade (`.tv-library-grid-panel.can-scroll-*`). */
    const val LightOpacity: Float = 0.62f

    /** Dark: opacity of the page-background scrim (`--edge-scrim-opacity`). */
    const val DarkScrimOpacity: Float = 0.96f

    /** Dark: the scrim holds 60% of its opacity at 40% of its length. */
    const val DarkScrimMidStop: Float = 0.4f
    const val DarkScrimMidAlpha: Float = 0.6f

    /** Light shade colour, `rgb(31 14 20)`. */
    const val LightShadeArgb: Long = 0xFF1F0E14

    /** Light shade stops: alpha at the centre, alpha at 46%, clear at 78%. */
    const val LightCentreAlpha: Float = 0.5f
    const val LightMidAlpha: Float = 0.18f
    const val LightMidStop: Float = 0.46f
    const val LightEndStop: Float = 0.78f

    /** Light band size along the scroll axis: `clamp(38, 5.5 vu, 64)` where one viewport unit is 1% of the height. */
    const val LightBandMinDp: Float = 38f
    const val LightBandMaxDp: Float = 64f
    const val LightBandViewportPercent: Float = 5.5f

    /** Dark scrim band: `clamp(56, 8 vu, 104)`. */
    const val DarkBandMinDp: Float = 56f
    const val DarkBandMaxDp: Float = 104f
    const val DarkBandViewportPercent: Float = 8f
}

object PlayarrPageTokens {
    val Tv = PlayarrPageMetrics(
        headerTop = 56.dp,
        start = 154.dp,
        // Web `--page-end` is clamp(24px, 4vw, 96px): 76.8 at the 1920 reference.
        headerEnd = 76.8.dp,
        bodyEnd = 72.dp,
        control = 50.dp,
        controlWidth = 50.dp,
        pillWidth = 62.dp,
        pillHeight = 72.dp,
        pillRadius = 14.dp,
        headerGap = 23.dp,
        actionsGap = 16.dp,
        dividerPad = 20.dp,
        bodyTop = 122.dp,
        safeBottom = 96.dp,
        focusRingWidth = 3.dp,
        focusRingOffset = 2.dp,
        // Web at 1920x1080: clamp(116, 14 vu, 164) = 151.2; clamp(5, 0.65 vw, 14) = 12.48; clamp(10, 1.2 vu, 16) = 12.96.
        shellColumnTop = 151.2.dp,
        shellColumnEdge = 12.48.dp,
        shellColumnGap = 12.96.dp,
    )

    val Phone = PlayarrPageMetrics(
        headerTop = 2.dp,
        start = 16.dp,
        // Web phone shell action column: `right: 66px`, a row of 44 px tiles left of the avatar with an 8 px gap.
        headerEnd = 66.dp,
        bodyEnd = 16.dp,
        control = 38.dp,
        controlWidth = 42.dp,
        pillWidth = 44.dp,
        pillHeight = 44.dp,
        pillRadius = 14.dp,
        headerGap = 10.dp,
        actionsGap = 8.dp,
        dividerPad = 20.dp,
        bodyTop = 72.dp,
        safeBottom = 72.dp,
        focusRingWidth = 2.dp,
        focusRingOffset = 3.dp,
        // Phones keep the actions in the header row, a row of tiles left of the avatar.
        shellColumnTop = 0.dp,
        shellColumnEdge = 0.dp,
        shellColumnGap = 8.dp,
    )

    fun of(formFactor: PlayarrFormFactor): PlayarrPageMetrics = if (formFactor == PlayarrFormFactor.Tv) Tv else Phone

    /** The metrics for the provided [LocalPlayarrFormFactor]. */
    @Composable
    @ReadOnlyComposable
    fun current(): PlayarrPageMetrics = of(LocalPlayarrFormFactor.current)
}

/** The page measurements for the form factor: screens read gutters and insets here and carry no literal of their own. */
fun playarrPageMetrics(isTelevision: Boolean): PlayarrPageMetrics = if (isTelevision) PlayarrPageTokens.Tv else PlayarrPageTokens.Phone
