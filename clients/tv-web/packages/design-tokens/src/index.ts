/**
 * @streamarr-tv/design-tokens
 *
 * Hand-authored placeholder token set for early TV/web app development.
 * These are consumed directly as TypeScript constants for now.
 *
 * NOTE: once the design system stabilizes, a canonical token source (e.g.
 * `tokens.json` in DTCG format) will feed Style Dictionary to generate
 * per-platform output -- CSS custom properties for the web app and VIDAA
 * fallback PWA, a webOS-safe CSS subset, and a restrained subset for the
 * Tizen legacy WebKit runtime (which has patchy support for modern CSS
 * functions). When that pipeline lands, this file becomes generated output
 * and should not be hand-edited.
 */

export const color = {
  background: {
    base: "#000000",
    elevated: "#121212",
    raised: "#1E1E1E",
    overlay: "rgba(0, 0, 0, 0.72)",
  },
  text: {
    primary: "#FFFFFF",
    secondary: "#B3B3B3",
    disabled: "#5C5C5C",
    inverse: "#000000",
  },
  brand: {
    primary: "#E50914",
    primaryHover: "#F6121D",
    primaryPressed: "#B00610",
  },
  focus: {
    ring: "#FFFFFF",
    ringOffset: "#E50914",
  },
  state: {
    success: "#2ECC71",
    warning: "#F5A623",
    error: "#E74C3C",
    info: "#3498DB",
  },
} as const;

/**
 * Spacing scale in CSS pixels, authored against a 1920x1080 "10-foot UI"
 * canvas. TV platforms with different safe-area requirements should scale
 * these via a viewport-level transform rather than redefining the scale.
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

export interface TypeScaleStep {
  fontSize: number;
  lineHeight: number;
  fontWeight: 400 | 500 | 600 | 700;
  letterSpacing?: number;
}

/**
 * Type scale sized for 10-foot viewing distance (TV), reused as-is by the
 * web app for visual consistency with the TV apps. Values are in CSS
 * pixels against the same 1920x1080 canvas as `spacing`.
 */
export const typeScale: Record<
  "caption" | "body" | "bodyEmphasis" | "subtitle" | "title" | "display",
  TypeScaleStep
> = {
  caption: { fontSize: 16, lineHeight: 22, fontWeight: 400 },
  body: { fontSize: 20, lineHeight: 28, fontWeight: 400 },
  bodyEmphasis: { fontSize: 20, lineHeight: 28, fontWeight: 600 },
  subtitle: { fontSize: 24, lineHeight: 32, fontWeight: 500 },
  title: { fontSize: 32, lineHeight: 40, fontWeight: 700 },
  display: { fontSize: 48, lineHeight: 56, fontWeight: 700, letterSpacing: -0.5 },
};

export const radius = {
  none: 0,
  sm: 4,
  md: 8,
  lg: 16,
  full: 9999,
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
export type TypeScaleTokens = typeof typeScale;
export type RadiusTokens = typeof radius;
export type FocusMotionTokens = typeof focusMotion;
