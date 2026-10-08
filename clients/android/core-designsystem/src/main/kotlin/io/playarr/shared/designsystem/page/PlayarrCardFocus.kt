package io.playarr.shared.designsystem.page

import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.Easing
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/*
 * The card half of the focus token pair (owner ruling, 8 October 2026: "it should just be a soft shadow plus the card
 * jump for media items"; focus state, not hover). Controls keep the ring (`playarrFocusRing`); media cards (poster,
 * thumbnail, episode tile, cast or content card) lift and cast a soft shadow, with no ring and no fill.
 *
 * Values are web's earlier card focus (reference commit de371253, pinned in docs/design/page-layout.md section 5 item 1a,
 * PR #232). Web TV is 1920x1080 px and Android TV runs the same layout at 1 dp = 1 px, so the CSS values carry over.
 */

/** How a focused card moves. */
@Immutable
data class PlayarrCardMotion(val lift: Dp, val scale: Float, val durationMs: Int, val easing: Easing)

private val CardEase = CubicBezierEasing(0.2f, 0.8f, 0.2f, 1f)

object PlayarrCardMotions {
    /** `.tv-episode-card` and other cards: translateY(-7px), 260 ms. */
    val Card = PlayarrCardMotion(7.dp, 1f, 260, CardEase)

    /** `.tv-home-card`: translateY(-6px). */
    val Home = PlayarrCardMotion(6.dp, 1f, 260, CardEase)

    /** `.tv-title-card` (library grid): translateY(-5px) scale(1.015). */
    val Library = PlayarrCardMotion(5.dp, 1.015f, 260, CardEase)

    /** `.tv-search-result`: translateY(-6px) scale(1.015), 230 ms cubic-bezier(0.16, 1, 0.3, 1). */
    val Search = PlayarrCardMotion(6.dp, 1.015f, 230, CubicBezierEasing(0.16f, 1f, 0.3f, 1f))

    /** The art inside a focused card: scale(1.025), 240 ms ease. */
    const val ArtScale: Float = 1.025f
    const val ArtDurationMs: Int = 240
}

/** One layer of a CSS box-shadow: `0 <offsetY> <blur> rgba(<colour>, <alpha>)`. */
@Immutable
data class PlayarrCardShadowLayer(val offsetY: Dp, val blur: Dp, val color: Color)

object PlayarrCardShadows {
    /** The action tile (`.action-pill`) and Filters launcher: `0 14px 36px rgba(56,38,33,.08)`. */
    val ActionTile = listOf(PlayarrCardShadowLayer(14.dp, 36.dp, Color(0xFF382621).copy(alpha = 0.08f)))

    private val Warm = Color(0xFF382621)
    private val Rose = Color(0xFF1F0E14)

    /** Focused art shadow: `0 24px 48px rgba(56,38,33,.30), 0 10px 20px rgba(56,38,33,.20)`. */
    val Focused = listOf(
        PlayarrCardShadowLayer(24.dp, 48.dp, Warm.copy(alpha = 0.30f)),
        PlayarrCardShadowLayer(10.dp, 20.dp, Warm.copy(alpha = 0.20f)),
    )

    /** Home: `0 26px 52px rgba(56,38,33,.32), 0 11px 22px rgba(56,38,33,.22)`. */
    val FocusedHome = listOf(
        PlayarrCardShadowLayer(26.dp, 52.dp, Warm.copy(alpha = 0.32f)),
        PlayarrCardShadowLayer(11.dp, 22.dp, Warm.copy(alpha = 0.22f)),
    )

    /** Search: `0 22px 52px rgba(31,14,20,.28)`. */
    val FocusedSearch = listOf(PlayarrCardShadowLayer(22.dp, 52.dp, Rose.copy(alpha = 0.28f)))

    /** Home art at rest (`.tv-home-card-art`): `0 10px 22px rgba(56,38,33,.16), 0 3px 9px rgba(56,38,33,.10)`. */
    val HomeRest = listOf(
        PlayarrCardShadowLayer(10.dp, 22.dp, Warm.copy(alpha = 0.16f)),
        PlayarrCardShadowLayer(3.dp, 9.dp, Warm.copy(alpha = 0.10f)),
    )

    /** Search art at rest (`.tv-search-result-art`): `0 12px 34px rgba(31,14,20,.16)`. */
    val SearchRest = listOf(PlayarrCardShadowLayer(12.dp, 34.dp, Rose.copy(alpha = 0.16f)))

    /** At rest: `0 10px 20px rgba(56,38,33,.14), 0 3px 8px rgba(56,38,33,.10)`. */
    val Rest = listOf(
        PlayarrCardShadowLayer(10.dp, 20.dp, Warm.copy(alpha = 0.14f)),
        PlayarrCardShadowLayer(3.dp, 8.dp, Warm.copy(alpha = 0.10f)),
    )
}

/**
 * Translates (and scales) this content per [motion] while [focused], animated.
 *
 * The lift is draw-only. Compose's 2D focus search reads the bounds of the focus target through the layer transforms of
 * the target and its ancestors; a lifted target made a lifted neighbour sit "below" its sibling and focus bounced
 * sideways forever (the #214 regression). So apply this to the CONTENT inside the focus target, never to the focus
 * target itself: the target keeps its unlifted layout bounds and only its child moves at draw time.
 */
@Composable
fun Modifier.mediaCardLift(focused: Boolean, motion: PlayarrCardMotion = PlayarrCardMotions.Card): Modifier {
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
