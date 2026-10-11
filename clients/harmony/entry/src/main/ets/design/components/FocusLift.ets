/**
 * The shared focus treatment for every content component in the Playarr
 * design system (brief section 5.8): a geometric LIFT -- `translateY` +
 * `scale` + an upgraded shadow -- never a focus ring/outline. HarmonyOS
 * hides the focus ring by default on the TV profile (brief 6.3); Playarr's
 * own visual identity never re-adds one, on any profile.
 *
 * This file is deliberately NOT a `@Component`. ArkUI focus deltas are
 * applied inline, inside each consuming component's own `build()`, driven
 * by that component's own focus state -- there is no shared visual host to
 * factor out. This file supplies only the numeric deltas (`FOCUS_LIFT`)
 * and the one piece of shared arithmetic every rail-hosted component needs
 * (`effectiveFocusPercent`).
 *
 * ## The pattern every sibling component in this design system MUST follow
 *
 * 1. Track a 0..1 focus progress as `@State focusPercent: number = 0`,
 *    animated toward `1` on `.onFocus()` and back to `0` on `.onBlur()`,
 *    using `design/Motion.ets`'s `INTERACTION_CURVE` and one of its
 *    interaction durations (`INTERACTION_CARD_MS` for cards/buttons/rail
 *    headings, `INTERACTION_TITLE_CARD_MS` for title/episode cards).
 * 2. Look up this component's delta from `FOCUS_LIFT` (e.g.
 *    `FOCUS_LIFT.homeCard`).
 * 3. If -- and only if -- this component lives inside a rail that may or
 *    may not itself hold focus (any card hosted by `MediaRail.ets`, or a
 *    rail heading), multiply `focusPercent` by
 *    `effectiveFocusPercent(focusPercent, activeRailFactor)` before
 *    applying the delta below, where `activeRailFactor` is a 0..1 value
 *    the *rail* passes down to its children (`1` while the rail itself
 *    holds focus, `0` otherwise). Components that are never rail-scoped
 *    (a library grid card, the primary play action, a button, an input,
 *    the profile avatar) pass `DEFAULT_ACTIVE_RAIL_FACTOR` instead, which
 *    is a no-op multiplier. Skipping this step is the exact regression the
 *    Roku port shipped: every rail's "selected" card appeared lifted at
 *    once, including the three rails that did not hold focus.
 * 4. Apply ONLY `.translateY(...)`, `.scale(...)` and a shadow upgrade
 *    (swap between a "rest" and "focused" shadow). Never set `.border()`,
 *    an outline, or any other focus-ring attribute as part of the focus
 *    response.
 *
 * Example (a card hosted inside a rail):
 *
 * ```
 * const delta = FOCUS_LIFT.homeCard;
 * const effective = effectiveFocusPercent(this.focusPercent, this.activeRailFactor);
 * const scale = 1 + (delta.scale - 1) * effective;
 * // .translateY((delta.translateY ?? 0) * effective)
 * // .scale({ x: scale, y: scale })
 * ```
 *
 * Two conflicting focus-scale values exist in the earlier research (a
 * `design-tokens` file claims `focusScale: 1.08 @150ms`, built for
 * Playarr Admin, not Playarr). Per the brief, the shipped-CSS values
 * below win -- not that file.
 */

/** One component's focus delta. `translateY` is omitted for components
 * that only ever scale (no vertical lift) -- e.g. the primary play action
 * scales in place about its own centre. */
export interface FocusLiftDelta {
  translateY?: number;
  scale: number;
}

/** The full brief-5.8 focus-delta table, one entry per content component
 * in this design system. */
export interface FocusLiftTable {
  homeCard: FocusLiftDelta;
  titleEpisodeCard: FocusLiftDelta;
  gridCard: FocusLiftDelta;
  primaryPlayAction: FocusLiftDelta;
  button: FocusLiftDelta;
  tvNavTileFocused: FocusLiftDelta;
  tvNavTileSelected: FocusLiftDelta;
  railHeading: FocusLiftDelta;
  input: FocusLiftDelta;
  profileAvatar: FocusLiftDelta;
}

/** Brief 5.8, copied verbatim. */
export const FOCUS_LIFT: FocusLiftTable = {
  homeCard: { translateY: -6, scale: 1.025 },
  titleEpisodeCard: { translateY: -7, scale: 1.025 },
  gridCard: { translateY: -5, scale: 1.015 },
  primaryPlayAction: { scale: 1.16 },
  button: { scale: 1.055 },
  tvNavTileFocused: { scale: 1.1 },
  tvNavTileSelected: { scale: 1.05 },
  railHeading: { translateY: -1, scale: 1.16 },
  input: { scale: 1.015 },
  // Web TV picker: a selected 244 px avatar draws at 264 px.
  profileAvatar: { scale: 1.082 },
};

/** A rail that never scopes focus (e.g. a library grid, or any
 * non-rail-hosted component) passes this no-op multiplier. */
export const DEFAULT_ACTIVE_RAIL_FACTOR: number = 1;

/**
 * The rail-scoped focus percentage a rail-hosted component should actually
 * animate toward. `activeRailFactor` is `1` while the hosting rail itself
 * holds focus and `0` otherwise, so a card can be "selected" within a rail
 * that does not currently hold focus without visually lifting.
 */
export function effectiveFocusPercent(focusPercent: number, activeRailFactor: number): number {
  return focusPercent * activeRailFactor;
}
