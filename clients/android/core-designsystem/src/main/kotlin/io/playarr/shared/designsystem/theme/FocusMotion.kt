package io.playarr.shared.designsystem.theme

/**
 * Focus scale/transition tokens aligned with Playarr Web's TV canvas.
 *
 * Source of truth:
 * - `clients/tv-web/packages/design-tokens` `focusMotion` (duration + easing)
 * - Live TV surface (`clients/tv-web/web/src/styles/global.css`) card/chrome
 *   grow-on-focus scales used on the spatial-nav grid
 *
 * [tileFocusScale] is the primary chrome/tile grow used across navigation
 * and library cards (CSS `scale(1.04)`). [cardFocusScale] matches the
 * poster-card focus treatment (`scale(1.045)`). [transitionMs] and the cubic
 * bezier control points match `focusMotion.transitionMs` /
 * `cubic-bezier(0.4, 0, 0.2, 1)`.
 */
object FocusMotion {
    const val restScale: Float = 1.0f

    /** Primary focused-tile scale used by nav chrome and library cards. */
    const val tileFocusScale: Float = 1.04f

    /** Poster / home-rail card focus scale (web `.poster-card > a:focus-visible`). */
    const val cardFocusScale: Float = 1.045f

    /** Selected-but-not-focused chrome scale (web selected nav affordance). */
    const val selectedScale: Float = 1.035f

    /** Nav rail focused icon button (web rail focus grows slightly more). */
    const val navFocusScale: Float = 1.1f

    /** Nav rail selected-but-unfocused scale. */
    const val navSelectedScale: Float = 1.05f

    /** Transition duration in milliseconds (`focusMotion.transitionMs`). */
    const val transitionMs: Int = 150

    /**
     * Cubic-bezier control points for `cubic-bezier(0.4, 0, 0.2, 1)`
     * (`focusMotion.transitionEasing`).
     */
    val easingControlPoints: FloatArray = floatArrayOf(0.4f, 0f, 0.2f, 1f)
}
