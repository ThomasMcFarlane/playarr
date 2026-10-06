/**
 * The proportion contract behind `TvStage.tsx`, pulled out into its own
 * dependency-free module so it can be unit-tested without a Kepler host --
 * see this file's `.test.ts` sibling, and `TvStage.tsx`'s own doc comment
 * for why the RN component itself is not render-tested under Jest (importing
 * `@amazon-devices/react-native-svg`/`react-linear-gradient` at module scope
 * throws "Invariant Violation: __fbBatchedBridgeConfig is not set" outside a
 * real Kepler runtime -- there is no Jest host-side mock for either package
 * yet, the same gap `src/__qrspike.test.tsx` -- someone else's in-flight
 * spike, not this file's concern -- currently hits).
 *
 * Design doc §4.7's own words: "The TvStage proportions are the contract,
 * not the pixels" -- every number below is copied from
 * `clients/tv-web/web/src/styles/global.css`'s real `.tv-key-art` /
 * `.tv-title-panel` / `.tv-rail-panel` rules (harvested by hand, the same
 * discipline `theme/tokens.ts` already established for colour), not
 * estimated or rounded to convenient values.
 *
 * Two of the CSS rules this harvests use `clamp()`/`vw`, which RN's
 * StyleSheet has no equivalent for at all (no CSS engine on Vega -- design
 * doc §4.7 again) -- `computeTvStageGeometry` below evaluates those two
 * formulas by hand, in real device pixels, given only the viewport's width
 * (the same "harvest and evaluate" approach `theme/tokens.ts`'s `geometry`
 * export takes for `--header-height`/`--screen-x`/`--screen-y`, except THIS
 * evaluation genuinely depends on the actual runtime viewport rather than a
 * single baked baseline number, because `clamp(44px, 7.5vw, 150px)` and
 * `min(27vw, 520px)` are not proportional-scale formulas -- they saturate
 * outside their clamped range, so no single `sw()`-style multiply could ever
 * reproduce them for every possible panel width).
 */

/** Clamps `value` to `[min, max]` -- CSS `clamp(min, value, max)`'s exact semantics, extracted as its own tiny named helper purely so the two call sites below read as "this IS a clamp()" rather than an unlabelled `Math.min(Math.max(...))`. */
function clamp(min: number, value: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * `.tv-key-art img`'s own rule: `width: 52%; height: 106%; object-position:
 * center 20%`. All three are plain percentages/fractions with no `vw`/
 * `clamp()` involved, so unlike the title/rail panels below there is
 * nothing here that depends on the runtime viewport size -- these are
 * static and exported directly as a constant rather than threaded through
 * a compute function that would just return them unchanged.
 */
export const TV_STAGE_KEY_ART = {
  widthPercent: 52,
  heightPercent: 106,
  /** `object-position: center 20%` -- RN's `<Image>` has no `object-position` equivalent (design doc has no assumption covering this; it is a known, accepted simplification -- see `TvStage.tsx`'s own doc comment for how the component compensates). Recorded here anyway so the exact source value is never lost if a future RN/Vega image API gains crop-focus support. */
  objectPositionYPercent: 20,
} as const;

/** `.tv-stage-wash`'s two overlapping linear gradients, as colour-mix percentages against `colour.surface` (design doc §4.7; the actual colour values live in `theme/tokens.ts`, not here -- this module only owns the geometry/opacity numbers, never a colour literal, so it never needs updating if the palette itself changes). */
export const TV_STAGE_WASH = {
  left: {surfaceMixPercent: 94, stopPercent: 31},
  right: {surfaceMixPercent: 50, stopPercent: 34},
} as const;

export interface TvStageTitlePanelGeometry {
  /** `.tv-title-panel { top: 31% }` -- a plain percentage, passed through unchanged. */
  topPercent: number;
  /** `left: clamp(44px, 7.5vw, 150px)`, evaluated against the real viewport width, in pixels. */
  left: number;
  /** `width: min(27vw, 520px)`, evaluated against the real viewport width, in pixels. */
  width: number;
}

export interface TvStageRailPanelGeometry {
  /** `.tv-rail-panel { top: 24% }`. */
  topPercent: number;
  /** `right: 3.8%`. */
  rightPercent: number;
  /** `width: 45%`. */
  widthPercent: number;
  /** `min-height: 39%`. */
  minHeightPercent: number;
}

export interface TvStageGeometry {
  titlePanel: TvStageTitlePanelGeometry;
  railPanel: TvStageRailPanelGeometry;
}

/**
 * Evaluates the two viewport-dependent CSS formulas
 * (`.tv-title-panel`'s `left`/`width`) against `viewportWidthPx` -- the rest
 * of the stage's geometry (key art, wash, the rail panel's own box) is
 * either a plain percentage RN's percentage-string styles express directly,
 * or has no viewport-relative component at all, so only the title panel
 * needs a real function rather than a static constant.
 */
export function computeTvStageGeometry(viewportWidthPx: number): TvStageGeometry {
  return {
    titlePanel: {
      topPercent: 31,
      left: clamp(44, viewportWidthPx * 0.075, 150),
      width: Math.min(viewportWidthPx * 0.27, 520),
    },
    railPanel: {
      topPercent: 24,
      rightPercent: 3.8,
      widthPercent: 45,
      minHeightPercent: 39,
    },
  };
}

export interface TvStageEntranceStep {
  durationMs: number;
  delayMs: number;
}

/**
 * The entrance-stagger contract design doc §4.7 names explicitly: key art
 * first (no delay), title-panel copy 90ms later, rail panel 120ms later
 * again -- each with its own duration, copied from `.tv-key-art`/
 * `.tv-title-panel`/`.tv-rail-panel`'s own `animation:` shorthand in
 * global.css (`760ms cubic-bezier(...)  both`, `620ms 90ms
 * cubic-bezier(...) both`, `700ms 120ms cubic-bezier(...) both`
 * respectively).
 */
export const TV_STAGE_ENTRANCE: {
  keyArt: TvStageEntranceStep;
  titlePanel: TvStageEntranceStep;
  railPanel: TvStageEntranceStep;
} = {
  keyArt: {durationMs: 760, delayMs: 0},
  titlePanel: {durationMs: 620, delayMs: 90},
  railPanel: {durationMs: 700, delayMs: 120},
};

/**
 * `cubic-bezier(0.16, 1, 0.3, 1)` -- the exact same easing curve every one
 * of the three `@keyframes` above uses (`tv-key-art-in`/`tv-copy-in`/
 * `tv-rail-in` in global.css). `Easing.bezier(...TV_STAGE_EASING)` in
 * `TvStage.tsx` plugs these four numbers straight into RN's own cubic-
 * bezier easing function, which takes the identical four-control-point
 * convention CSS does.
 */
export const TV_STAGE_EASING: readonly [number, number, number, number] = [0.16, 1, 0.3, 1];
