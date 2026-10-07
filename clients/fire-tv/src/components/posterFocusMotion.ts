/**
 * `PosterCard.tsx`'s focus-scale arithmetic, extracted into its own
 * dependency-free module for the same reason every other `*.ts` sibling in
 * this directory is: so it can be unit-tested without a Kepler host (see
 * `tvStageGeometry.ts`'s doc comment for exactly why importing
 * `@amazon-devices/react-native-svg`/`react-linear-gradient` at module scope
 * cannot run under Jest today).
 *
 * Design doc §4.4's own words: "Rails carry the `activeRailFactor` idea from
 * Roku's `PosterCard`/`ProfileAvatar` -- focus visuals multiply by whether
 * the rail is the active one -- because the stale-focus-border bug it fixes
 * is a real one on multi-rail screens." Ported from
 * `clients/roku/components/PosterCard.brs`'s own `onFocusChanged()`:
 *
 *   effective = m.top.focusPercent * m.top.activeRailFactor
 *   artScale = 1 + (effective * 0.025)
 *
 * On Roku's SceneGraph, `focusPercent` is a continuous 0-1 interpolated
 * value driven by that platform's own row/item focus-animation node, and
 * `activeRailFactor` (0 or 1) is bound per-row so a card belonging to a rail
 * that is no longer the actively-navigated one cannot keep showing a
 * lingering "I am focused" scale-up after focus has moved to a different
 * rail entirely -- SceneGraph decouples "this item's row is focused" from
 * "this specific item widget still thinks it's focused" in a way that can
 * genuinely drift out of sync between re-renders.
 *
 * RN/Vega's own focus engine does not have that same failure mode -- a
 * `Pressable`'s `onFocus`/`onBlur` fire exactly when the true native focus
 * lands on or leaves THAT view, with no separate row-level focus concept to
 * fall out of sync with it. `focused` below is therefore always an honest,
 * instantaneous boolean (never Roku's continuous `focusPercent`), and
 * `activeRailFactor` is kept as a defensive knob for the one case that
 * genuinely can still happen on Vega: a screen that wants to visually
 * de-emphasise a card's focus ring while a modal (e.g. a PIN prompt) has
 * taken over input, without that card ever having received a real `onBlur`
 * -- `TvStage.tsx`/screens that layer a modal over a rail can pass
 * `activeRailFactor={0}` to every card behind it for exactly that window,
 * rather than each card needing its own awareness of "is a modal currently
 * open".
 */
import {focusMotion} from '../theme/tokens';

/**
 * The `Animated.Value` scale a `PosterCard` should animate to.
 * `activeRailFactor` is clamped to `[0, 1]` defensively -- a caller passing
 * an out-of-range value should degrade to the nearest valid behaviour
 * (fully active or fully suppressed) rather than producing a scale outside
 * `[1, focusMotion.focusScale]` that no design anywhere calls for.
 */
export function effectiveFocusScale(focused: boolean, activeRailFactor: number = 1): number {
  const factor = Math.min(1, Math.max(0, activeRailFactor));
  const effective = (focused ? 1 : 0) * factor;
  return focusMotion.restScale + effective * (focusMotion.focusScale - focusMotion.restScale);
}
