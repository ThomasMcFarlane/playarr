/**
 * Named motion curves and durations (brief section 5.7), as real ArkUI
 * values instead of raw literals scattered across every animated
 * component.
 *
 * `ENTRY_CURVE`/`INTERACTION_CURVE` are built via `curves.cubicBezierCurve`
 * (`@kit.ArkUI`) from `core/Tokens.ts`'s `Motion.entryCurve`/
 * `Motion.interactionCurve` control-point arrays -- never re-typed as a
 * fresh `[x1,y1,x2,y2]` literal here. Every other export below is a
 * pass-through re-export of a single named field of `core/Tokens.ts`'s
 * `Motion` object, so ArkUI animation code can write
 * `animateTo({ duration: INTERACTION_CARD_MS, curve: INTERACTION_CURVE }, ...)`
 * instead of restating a millisecond literal.
 *
 * Two exceptions, called out explicitly: `SPINNER_ROTATION_MS` (720) and
 * `SKELETON_SHIMMER_MS` (1400) are real brief-5.7 timings that are NOT
 * present in `core/Tokens.ts`'s `MotionTokens` interface (that table only
 * captures the entry/interaction/fade timings, not the loading-state
 * ones). They are defined here, once, verbatim from the brief, so
 * `design/components/AsyncState.ets` and `design/components/Skeleton.ets`
 * import a name instead of each re-stating the raw millisecond literal.
 */

import { curves } from '@kit.ArkUI';
import { Motion as MotionTokens } from '../core/Tokens';

/** Entry/reveal curve -- `cubic-bezier(0.16, 1, 0.3, 1)` (expo-out). */
export const ENTRY_CURVE = curves.cubicBezierCurve(
  MotionTokens.entryCurve[0],
  MotionTokens.entryCurve[1],
  MotionTokens.entryCurve[2],
  MotionTokens.entryCurve[3]
);

/** Interaction curve -- `cubic-bezier(0.2, 0.8, 0.2, 1)`. */
export const INTERACTION_CURVE = curves.cubicBezierCurve(
  MotionTokens.interactionCurve[0],
  MotionTokens.interactionCurve[1],
  MotionTokens.interactionCurve[2],
  MotionTokens.interactionCurve[3]
);

// -- Entry / reveal durations (ENTRY_CURVE) --------------------------------

export const ENTRY_KEY_ART_MS: number = MotionTokens.entryKeyArtMs;
export const ENTRY_COPY_MS: number = MotionTokens.entryCopyMs;
export const ENTRY_COPY_DELAY_MS: number = MotionTokens.entryCopyDelayMs;
export const ENTRY_PRIMARY_ACTION_MS: number = MotionTokens.entryPrimaryActionMs;
export const ENTRY_PRIMARY_ACTION_DELAY_MS: number = MotionTokens.entryPrimaryActionDelayMs;
export const ENTRY_RAILS_MS: number = MotionTokens.entryRailsMs;
export const ENTRY_RAILS_DELAY_MS: number = MotionTokens.entryRailsDelayMs;
export const DRAWER_MS: number = MotionTokens.drawerMs;

// -- Interaction durations (INTERACTION_CURVE) -----------------------------

export const INTERACTION_CARD_MS: number = MotionTokens.interactionCardMs;
export const INTERACTION_TITLE_CARD_MS: number = MotionTokens.interactionTitleCardMs;
export const INTERACTION_NAV_EXPAND_MS: number = MotionTokens.interactionNavExpandMs;

// -- Property fades (ease) --------------------------------------------------

export const FADE_OPACITY_MS: number = MotionTokens.fadeOpacityMs;
export const FADE_COLOR_MS: number = MotionTokens.fadeColorMs;
export const FADE_SHADOW_MS: number = MotionTokens.fadeShadowMs;

// -- Loading-state timings (brief 5.7; not in core/Tokens.ts, see header) --

/** Mini-loader spinner: 720ms, linear, infinite rotation. */
export const SPINNER_ROTATION_MS: number = 720;

/** Skeleton shimmer sweep: 1.4s, linear, infinite translateX. */
export const SKELETON_SHIMMER_MS: number = 1400;
