/**
 * Design tokens, following the discipline Roku's `Theme.brs` established
 * for this repo (design doc §4.7): import what genuinely can be imported,
 * harvest and comment what cannot.
 *
 * `spacing`/`typeScale`/`radius`/`focusMotion` come straight from
 * `@playarr-tv/design-tokens` -- it is plain, DOM-free TypeScript, so
 * unlike Roku (BrightScript cannot import a TS package at all) there is no
 * reason to re-derive these by hand; doing so would just be a second copy
 * that can silently drift from the first.
 *
 * `colour` does NOT come from `@playarr-tv/design-tokens` for most of its
 * values: the shipped Playarr web app does not actually consume that
 * package's `color` export (it has its own, hand-authored CSS instead), so
 * that export is not this app's ground truth for what Playarr's dark theme
 * actually looks like. The real palette lives in
 * `clients/tv-web/web/src/styles/global.css`'s
 * `:root[data-theme="dark"]` block, and every value below was read from
 * there directly (not estimated) -- see `tokens.test.ts`, which re-reads
 * that same file at test time and fails the moment this object and the CSS
 * disagree, so a future edit to one side can never silently leave the
 * other stale.
 *
 * Two colours below are the deliberate exception, sourced from
 * `@playarr-tv/design-tokens` rather than the CSS file, because they are
 * genuinely shared, cross-client concepts rather than this one app's own
 * palette: the focus ring (the same blue every *arr app and every Playarr
 * client uses for every focusable) and the nav accent (Playarr's narrow,
 * "nav-item hover/active only" brand red -- see that package's own doc
 * comment for why it is reserved for that one role and never used as a
 * general button/CTA colour).
 */
import {
  color as sharedColor,
  focusMotion,
  radius,
  spacing,
  typeScale,
  type TypeScaleStep,
} from '@playarr-tv/design-tokens';

export {focusMotion, radius, spacing, typeScale};
export type {TypeScaleStep};

export const colour = {
  /** --bg -- the outermost canvas. */
  bg: '#151315',
  /** --surface -- cards, rails, the stage's rail panel. */
  surface: '#1b181b',
  /** --surface-strong -- the nav rail's own chrome, modals. */
  surfaceStrong: '#211d21',
  /** --surface-soft -- a slightly raised surface (e.g. a selected-but-unfocused card). */
  surfaceSoft: '#312a30',
  /** --ink -- default body/heading text. */
  ink: '#f4f0f1',
  /** --ink-soft -- secondary/meta text. */
  inkSoft: '#c5b8bd',
  /** --ink-muted -- placeholder/disabled text, and the page-kicker label colour. */
  inkMuted: '#887a82',
  /** --line -- low-emphasis hairline dividers. */
  line: 'rgba(223, 220, 221, 0.11)',
  /** --line-strong -- higher-emphasis dividers (e.g. under the nav rail). */
  lineStrong: 'rgba(223, 220, 221, 0.23)',
  /** --accent -- this theme's own neutral accent (buttons, active states that are NOT the nav's brand-red role). */
  accent: '#dfdcdd',
  /** --accent-soft -- a muted variant of the above (e.g. a pressed/hover background). */
  accentSoft: '#675961',
  /** --on-accent -- text/icon colour placed on top of `accent`. */
  onAccent: '#211d21',
  /** --danger -- destructive actions, error text. */
  danger: '#ee9297',
  /** --danger-soft -- a danger-toned background (e.g. behind a destructive confirm button). */
  dangerSoft: '#392326',
  /** --success -- confirmation states. */
  success: '#7fc09d',
  /** --focus-outline -- the CSS `:focus-visible` outline colour. Distinct from `focusRing` below: this is the plain-outline treatment, `focusRing` is the *arr-family shared token used for the scale/glow-style focus treatment `focusMotion` describes. */
  focusOutline: '#dfdcdd',

  // --- Shared @playarr-tv/design-tokens values, not from global.css ---
  /** Shared *arr UI primary, reused here as Playarr's own focus-ring colour -- identical across Sonarr/Radarr/Lidarr/every Playarr client. */
  focusRing: sharedColor.brand.primary,
  /** Playarr's own brand accent. NAV HOVER/ACTIVE ONLY -- never a general button/CTA colour; see `@playarr-tv/design-tokens`'s own doc comment. */
  navAccent: sharedColor.brand.accent,

  // --- Harvested from a specific pair of tv-web classes, not the theme's :root block ---
  /** `.tv-provider` / `.tv-detail-kicker` in global.css -- the stage's kicker label and the player's own accent. Distinct from both `accent` above and `navAccent`. */
  stageKicker: '#cf3157',
} as const;

export type Colour = typeof colour;

/**
 * Evaluated once, by hand, from the exact CSS this app has no `clamp()`/
 * `vw`/`vh` engine to evaluate itself, at the 1920x1080 TV canvas
 * `theme/scale.ts` treats as baseline -- the same approach Roku's
 * `Theme.brs` takes, for the same reason (no CSS engine there either):
 *
 *   --header-height: clamp(78px, calc(8.5 * 1vh), 112px)  -> clamp(78, 91.8, 112)  = 91.8 ~ 92
 *   --screen-x:      clamp(28px, 4.5vw,          92px)    -> clamp(28, 86.4, 92)   = 86.4 ~ 86
 *   --screen-y:      clamp(24px, calc(3.5 * 1vh), 54px)   -> clamp(24, 37.8, 54)   = 37.8 ~ 38
 *
 * (`--viewport-unit` is `1vh` on every viewport this app's baseline cares
 * about; global.css's `max(1vh, 1dvh)` branch only matters for mobile
 * browser chrome show/hide, which does not apply to a TV.) Re-verify these
 * three numbers against global.css directly if `--header-height`/
 * `--screen-x`/`--screen-y`'s own formulas ever change; `tokens.test.ts`
 * only locks the *colour* values against that file, not this arithmetic.
 */
export const geometry = {
  headerHeight: 92,
  screenX: 86,
  screenY: 38,
} as const;

export type Geometry = typeof geometry;
