/**
 * Shimmering placeholder for artwork and text-line loading states (brief
 * section 5.7). A flat `surfaceSoft` fill (from the active theme's colour
 * tokens, `design/Theme.ets`) with a soft diagonal highlight band that
 * sweeps left-to-right on an infinite 1.4s loop, mirroring the source
 * CSS's `linear-gradient(100deg, transparent 20%, rgba(255,255,255,0.4)
 * 48%, transparent 76%)` (alpha `0.07` instead of `0.4` in dark mode).
 *
 * The `20%`/`48%`/`76%` gradient stops and the `100deg` angle come
 * straight from the brief. The `0.4`/`0.07` highlight alphas and the pure
 * white (`255,255,255`) highlight colour are brief-5.7 literals that have
 * no matching entry in `core/Tokens.ts`'s `ColorTokens` (no theme role is
 * "pure white in light mode, near-transparent white in dark mode" -- the
 * closest candidate, `onAccent`, is white in light mode but
 * `#211d21` in dark, which is not this effect), so they are named
 * constants here rather than silently re-typed inline at each use.
 *
 * Usage: `Skeleton({ blockWidth: 219, blockHeight: 123, radius: Radii.homeCardArtworkTv })`
 * anywhere a card, artwork tile or text line is still loading.
 */

import { activeColors, toResourceColor, resolvedThemeMode } from '../Theme';
import type { ThemeModeSetting } from '../Theme';
import { SKELETON_SHIMMER_MS } from '../Motion';

const SHIMMER_ANGLE_DEG: number = 100;
const SHIMMER_OVERLAY_WIDTH_PERCENT: string = '220%';
const SHIMMER_HIGHLIGHT_ALPHA_LIGHT: number = 0.4;
const SHIMMER_HIGHLIGHT_ALPHA_DARK: number = 0.07;

@Component
export struct Skeleton {
  @Prop blockWidth: number = 100;
  @Prop blockHeight: number = 100;
  @Prop radius: number = 0;

  // Tracked purely to force a re-render when the theme changes; the actual
  // colour decision always goes through design/Theme.ets's own resolver
  // functions below (see that file's header comment for this pattern).
  @StorageProp('colorMode') private sysColorMode: ColorMode = ColorMode.LIGHT;
  @StorageProp('themeModeSetting') private themeSetting: ThemeModeSetting = 'system';

  @State private sweepPercent: number = -100;

  aboutToAppear(): void {
    this.getUIContext().animateTo(
      { duration: SKELETON_SHIMMER_MS, curve: Curve.Linear, iterations: -1 },
      () => {
        this.sweepPercent = 100;
      }
    );
  }

  private highlightAlpha(): number {
    if (resolvedThemeMode() === 'dark') {
      return SHIMMER_HIGHLIGHT_ALPHA_DARK;
    }
    return SHIMMER_HIGHLIGHT_ALPHA_LIGHT;
  }

  build() {
    Stack() {
      Row()
        .width(SHIMMER_OVERLAY_WIDTH_PERCENT)
        .height('100%')
        .linearGradient({
          angle: SHIMMER_ANGLE_DEG,
          colors: [
            [toResourceColor({ r: 255, g: 255, b: 255, a: 0 }), 0.2],
            [toResourceColor({ r: 255, g: 255, b: 255, a: (this.highlightAlpha()) }), 0.48],
            [toResourceColor({ r: 255, g: 255, b: 255, a: 0 }), 0.76],
          ],
        })
        .translate({ x: `${this.sweepPercent}%` })
    }
    .width(this.blockWidth)
    .height(this.blockHeight)
    .backgroundColor(toResourceColor(activeColors().surfaceSoft))
    .borderRadius(this.radius)
    .clip(true)
  }
}
