/**
 * @playarr-tv/design-tokens
 *
 * Hand-authored token set for early TV/web app development, corrected to
 * match the *real*, verified Sonarr/Radarr/Lidarr ("*arr") design language
 * (Styles/Themes/dark.js and Styles/Variables/fonts.js -- byte-identical
 * between Sonarr and Radarr, Lidarr matches on everything but its own brand
 * accent). Playarr Server wraps that suite, so its web app should read as a
 * member of the same family rather than a generic dark dashboard.
 *
 * These are consumed directly as TypeScript constants for now. NOTE: once
 * the design system stabilizes, a canonical token source (e.g. `tokens.json`
 * in DTCG format) will feed Style Dictionary to generate per-platform
 * output -- CSS custom properties for the web app and VIDAA fallback PWA, a
 * webOS-safe CSS subset, and a restrained subset for the Tizen legacy
 * WebKit runtime (which has patchy support for modern CSS functions). When
 * that pipeline lands, this file becomes generated output and should not be
 * hand-edited.
 *
 * IMPORTANT semantic change vs. the previous placeholder version:
 * `color.brand.primary` used to be Playarr Server's red and was used everywhere
 * (buttons, focus rings, etc). The real *arr apps do NOT do this -- they
 * share ONE generic UI primary color (#5d9cec, a periwinkle blue) across
 * every button/link/checkbox/focus-ring in all three apps, and reserve each
 * app's own distinct brand color for a narrow role: nav-item hover text and
 * the active-nav-item left border/text only. `color.brand.primary` now
 * holds that shared blue. Playarr Server's own red identity lives at the NEW
 * `color.brand.accent` token and must only be used for that narrow nav
 * role -- never as a general button/CTA color.
 */

export const color = {
  background: {
    /** Page/base background -- the outermost canvas. */
    base: "#202020",
    /** "Chrome" surfaces: sidebar, top header, modals, popovers. */
    elevated: "#2a2a2a",
    /** Cards (poster info strip, provider/settings cards) and default inputs. */
    raised: "#333333",
    /** Flat scrim overlay (e.g. over a detail-page backdrop banner). Flat, not a gradient. */
    overlay: "rgba(0, 0, 0, 0.7)",
    /** Read-only / disabled input background. */
    inputDisabled: "#222222",
  },
  text: {
    /** Default body text color. */
    primary: "#cccccc",
    /** Muted secondary text (meta lines, less prominent info). */
    secondary: "#999999",
    /** Disabled-state text. */
    disabled: "#909293",
    /** Help/hint text under form fields. Same source value as `disabled`; kept as its own key for semantic clarity. */
    help: "#909293",
    /** Headings/labels rendered on top of a colored surface (e.g. inside a colored banner or button). */
    inverse: "#ffffff",
  },
  brand: {
    /** Shared *arr UI primary: buttons, links, checkboxes, focus rings. NOT Playarr Server-specific -- identical across Sonarr/Radarr/Lidarr. */
    primary: "#5d9cec",
    primaryHover: "#7badf0",
    primaryPressed: "#4a84d1",
    /** Playarr Server's own distinct accent (its "red identity"), applied the way Sonarr/Radarr/Lidarr apply theirs: nav-item hover text + active-nav-item left border/text ONLY. Never a general button color. */
    accent: "#e5484d",
    accentHover: "#ef6469",
    accentPressed: "#c93a3e",
  },
  focus: {
    /** Focus-ring color, matches the shared UI primary. */
    ring: "#5d9cec",
    ringOffset: "#2a2a2a",
    /** Box-shadow-based default input focus glow. Note: the real theme's input-focus blue (#66afe9, Bootstrap-derived) is a distinct shade from the shared UI primary (#5d9cec) -- both are authoritative, used in different places. */
    glow: "rgba(102, 175, 233, 0.6)",
    /** Validation-state glow variants, same box-shadow treatment. */
    glowError: "rgba(240, 80, 80, 0.6)",
    glowWarning: "rgba(255, 165, 0, 0.6)",
  },
  state: {
    /** Success action/button background. */
    success: "#27c24c",
    /** Success text/label color (distinct from the button bg per the real theme). */
    successLabel: "#00853d",
    warning: "#ffa500",
    /** Danger/error. */
    error: "#f05050",
    /** Same value as `brand.primary` / `focus.ring` in the real theme. */
    info: "#5d9cec",
    /** Distinctive purple reserved for active-download/queue/progress bars (e.g. transcode or sync-in-progress) -- not success/info. */
    queue: "#7a43b6",
  },
  border: {
    /** Low-visual-weight divider/card border color. */
    default: "#858585",
  },
  /** Card drop-shadow color, used as `0 0 10px 1px ${color.shadow}`. */
  shadow: "#111111",
} as const;

/**
 * Spacing scale in CSS pixels, authored against a 1920x1080 "10-foot UI"
 * canvas. TV platforms with different safe-area requirements should scale
 * these via a viewport-level transform rather than redefining the scale.
 * (Unaffected by the *arr web research below -- that's a different design
 * context. The web app's own layout constants -- 210px sidebar, 60px
 * header, 20px/10px content padding -- are authored directly in
 * `web/src/styles/global.css` rather than folded into this TV-canvas scale.)
 */
export const spacing = {
  none: 0,
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
  xxxl: 64,
} as const;

/**
 * Font stacks (Styles/Variables/fonts.js, byte-identical Sonarr/Radarr).
 */
export const font = {
  family: 'Roboto, "open sans", "Helvetica Neue", Helvetica, Arial, sans-serif',
  familyMono: '"Ubuntu Mono", Menlo, Monaco, Consolas, "Courier New", monospace',
} as const;

export interface TypeScaleStep {
  fontSize: number;
  lineHeight: number;
  /** 300 (light) is a deliberate signature for large display titles -- not a mistake. */
  fontWeight: 300 | 400 | 500 | 600 | 700;
  letterSpacing?: number;
}

/**
 * Type scale sized against the real *arr body scale: 14px default body,
 * line-height ratio 1.428571429 (20px at 14px, the classic 20/14 Bootstrap
 * ratio the real app's SCSS derives its own line-heights from). Reused as-is
 * by the web app for visual consistency with the TV apps.
 *
 * `display` (50px/300) is the detail-page title treatment: deliberately
 * thin, not bold, at very large size -- a recognizable *arr signature that
 * distinguishes it from typical bold-everything dark dashboards.
 */
export const typeScale: Record<
  "micro" | "caption" | "body" | "bodyEmphasis" | "subtitle" | "title" | "display",
  TypeScaleStep
> = {
  /** Extra-small text: tiny badges, dense help text. */
  micro: { fontSize: 11, lineHeight: 16, fontWeight: 400 },
  /** Small text: meta lines, table headers, hints. */
  caption: { fontSize: 12, lineHeight: 17, fontWeight: 400 },
  /** Default body text. */
  body: { fontSize: 14, lineHeight: 20, fontWeight: 400 },
  bodyEmphasis: { fontSize: 14, lineHeight: 20, fontWeight: 700 },
  /** Detail-page secondary info line (kind/genres/year/etc). Light weight per the real theme. */
  subtitle: { fontSize: 18, lineHeight: 26, fontWeight: 300 },
  /** Section/accordion headers (settings sections, season headers). */
  title: { fontSize: 24, lineHeight: 34, fontWeight: 700 },
  /** Detail-page hero title. */
  display: { fontSize: 50, lineHeight: 71, fontWeight: 300 },
};

/**
 * Radius scale. The real theme does NOT use one uniform radius -- cards,
 * buttons/inputs, badges, and modals are each a different value. The
 * generic none/sm/md/lg/full scale is kept for existing consumers; the
 * named semantic keys (card/button/input/badge/pill/modal) are the exact
 * values from the real theme and are what new component CSS should use.
 */
export const radius = {
  none: 0,
  sm: 4,
  md: 6,
  lg: 8,
  full: 9999,
  /** Cards (poster info strip, provider/settings cards). */
  card: 3,
  /** Buttons. */
  button: 4,
  /** Inputs. */
  input: 4,
  /** Generic labels/badges. */
  badge: 2,
  /** Pill-shaped status labels (fully rounded). */
  pill: 9999,
  /** Modals. */
  modal: 6,
} as const;

/** Scale/transition applied to a focused tile in the spatial-nav grid; mirrors the "grow on focus" TV convention. */
export const focusMotion = {
  restScale: 1,
  focusScale: 1.08,
  transitionMs: 150,
  transitionEasing: "cubic-bezier(0.4, 0, 0.2, 1)",
} as const;

export type ColorTokens = typeof color;
export type SpacingTokens = typeof spacing;
export type FontTokens = typeof font;
export type TypeScaleTokens = typeof typeScale;
export type RadiusTokens = typeof radius;
export type FocusMotionTokens = typeof focusMotion;
