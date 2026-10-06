/**
 * The Playarr brand mark (brief section 5.12), rendered at a caller-given
 * size.
 *
 * The mark's three stroked arcs, its gradient and its play wedge already
 * exist as a real, shipped SVG asset at
 * `entry/src/main/resources/base/media/playarr_logo.svg`. This component
 * references that asset via `$r('app.media.playarr_logo')` rather than
 * re-drawing the same vector paths a second time in an ArkUI `Canvas` --
 * simpler, and guaranteed pixel-identical to the shipped asset (no risk of
 * a second, subtly-different hand-copy of the gradient stops / arc radii
 * drifting from the source SVG over time).
 *
 * Usage: `PlayarrLogo({ logoSize: TvGeometry.logoSize })` on the TV profile
 * (brief 5.9: 42, at `left 59, top 34`), or any other caller-chosen size
 * (e.g. a smaller mark in a touch-profile header).
 */

import { TvGeometry } from '../../core/Tokens';

@Component
export struct PlayarrLogo {
  /** Side length, in vp, of the (square) logo mark. Defaults to the TV
   * stage's own logo size (brief 5.9) rather than an independently
   * re-typed literal. */
  @Prop logoSize: number = TvGeometry.logoSize;

  build() {
    Image($r('app.media.playarr_logo'))
      .width(this.logoSize)
      .height(this.logoSize)
      .objectFit(ImageFit.Contain)
      .draggable(false)
      .focusable(false)
  }
}
