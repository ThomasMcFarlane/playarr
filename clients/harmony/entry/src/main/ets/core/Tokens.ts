/**
 * Design tokens for Playarr on HarmonyOS NEXT.
 *
 * Source of truth: clients/tv-web/web/src/styles/global.css (see the
 * implementation brief, section 5 "Design tokens to port"). Do NOT port
 * @playarr-tv/design-tokens -- that is an *arr-derived, dark-only set for
 * Playarr Server Admin and its palette appears nowhere in Playarr.
 *
 * This file is a plain-TypeScript data-literal module: no ArkUI, no
 * @kit./@ohos. imports, no decorators. Every value below is copied
 * verbatim from the brief; colours are expressed as {r,g,b,a} numeric
 * records (rather than CSS strings) so later ArkUI Color()/rgba
 * consumption is trivial and type-safe.
 */

/** A colour expressed as 0-255 channel values plus a 0-1 alpha. */
export interface RgbaColor {
  r: number;
  g: number;
  b: number;
  a: number;
}

/** The 16 theme-dependent colour roles (brief 5.1 / 5.2). Only these
 * change between light and dark -- geometry, type and motion are
 * theme-invariant. */
export interface ColorTokens {
  bg: RgbaColor;
  surface: RgbaColor;
  surfaceStrong: RgbaColor;
  surfaceSoft: RgbaColor;
  ink: RgbaColor;
  inkSoft: RgbaColor;
  inkMuted: RgbaColor;
  line: RgbaColor;
  lineStrong: RgbaColor;
  accent: RgbaColor;
  accentSoft: RgbaColor;
  onAccent: RgbaColor;
  danger: RgbaColor;
  dangerSoft: RgbaColor;
  success: RgbaColor;
  focusOutline: RgbaColor;
}

/** Brief 5.1 -- colours, light (`:root`). The ink family is a warm
 * brown-mauve, not neutral grey. */
export const LightColors: ColorTokens = {
  bg: { r: 245, g: 243, b: 242, a: 1 },
  surface: { r: 251, g: 250, b: 249, a: 1 },
  surfaceStrong: { r: 255, g: 255, b: 255, a: 1 },
  surfaceSoft: { r: 223, g: 220, b: 221, a: 1 },
  ink: { r: 56, g: 38, b: 33, a: 1 },
  inkSoft: { r: 103, g: 89, b: 97, a: 1 },
  inkMuted: { r: 165, g: 150, b: 158, a: 1 },
  line: { r: 56, g: 38, b: 33, a: 0.14 },
  lineStrong: { r: 56, g: 38, b: 33, a: 0.28 },
  accent: { r: 103, g: 89, b: 97, a: 1 },
  accentSoft: { r: 197, g: 184, b: 189, a: 1 },
  onAccent: { r: 255, g: 255, b: 255, a: 1 },
  danger: { r: 168, g: 70, b: 76, a: 1 },
  dangerSoft: { r: 242, g: 223, b: 225, a: 1 },
  success: { r: 52, g: 117, b: 89, a: 1 },
  focusOutline: { r: 103, g: 89, b: 97, a: 1 },
};

/** Brief 5.2 -- colours, dark (`:root[data-theme="dark"]`). */
export const DarkColors: ColorTokens = {
  bg: { r: 21, g: 19, b: 21, a: 1 },
  surface: { r: 27, g: 24, b: 27, a: 1 },
  surfaceStrong: { r: 33, g: 29, b: 33, a: 1 },
  surfaceSoft: { r: 49, g: 42, b: 48, a: 1 },
  ink: { r: 244, g: 240, b: 241, a: 1 },
  inkSoft: { r: 197, g: 184, b: 189, a: 1 },
  inkMuted: { r: 136, g: 122, b: 130, a: 1 },
  line: { r: 223, g: 220, b: 221, a: 0.11 },
  lineStrong: { r: 223, g: 220, b: 221, a: 0.23 },
  accent: { r: 223, g: 220, b: 221, a: 1 },
  accentSoft: { r: 103, g: 89, b: 97, a: 1 },
  onAccent: { r: 33, g: 29, b: 33, a: 1 },
  danger: { r: 238, g: 146, b: 151, a: 1 },
  dangerSoft: { r: 57, g: 35, b: 38, a: 1 },
  success: { r: 127, g: 192, b: 157, a: 1 },
  focusOutline: { r: 223, g: 220, b: 221, a: 1 },
};

/** Brief 5.3 -- the Playarr pink, `#cf3157`. Identical in light and dark,
 * reserved for a narrow kicker/highlight/player role. It is NOT the
 * button colour -- `.btn-primary` uses `accent`/`onAccent` instead. */
export const BRAND_PINK: RgbaColor = { r: 207, g: 49, b: 87, a: 1 };

/** Brief 5.5 -- spacing scale (unitless). */
export interface SpacingTokens {
  none: number;
  xs: number;
  sm: number;
  md: number;
  lg: number;
  xl: number;
  xxl: number;
  xxxl: number;
}

export const Spacing: SpacingTokens = {
  none: 0,
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
  xxxl: 64,
};

/** Brief 5.5 -- named radii. Deliberately inconsistent; do not normalise.
 * `circleFull` is not numeric (it is "50%" in the source CSS) so it is
 * modelled as a string field on the same interface -- every other surface
 * that resolves to a true circle (primary play action, avatars) reads
 * this field rather than a magic number. */
export interface RadiiTokens {
  homeCardArtworkTv: number;
  homeCardArtworkTouch: number;
  titleEpisodeCard: number;
  gridCardHitArea: number;
  railPanel: number;
  drawerButton: number;
  drawerInput: number;
  pillFull: number;
  btn: number;
  inputFlat: number;
  circleFull: string;
}

export const Radii: RadiiTokens = {
  homeCardArtworkTv: 12.5,
  homeCardArtworkTouch: 10,
  titleEpisodeCard: 13.4,
  gridCardHitArea: 12,
  railPanel: 2,
  drawerButton: 14,
  drawerInput: 12,
  pillFull: 999,
  btn: 0,
  inputFlat: 0,
  circleFull: "50%",
};

/** Brief 5.7 -- motion. Two cubic-bezier curves (as [x1,y1,x2,y2] control
 * point tuples) plus every named duration/delay in milliseconds. */
export interface MotionTokens {
  entryCurve: number[];
  interactionCurve: number[];
  entryKeyArtMs: number;
  entryCopyMs: number;
  entryCopyDelayMs: number;
  entryPrimaryActionMs: number;
  entryPrimaryActionDelayMs: number;
  entryRailsMs: number;
  entryRailsDelayMs: number;
  drawerMs: number;
  interactionCardMs: number;
  interactionTitleCardMs: number;
  interactionNavExpandMs: number;
  fadeOpacityMs: number;
  fadeColorMs: number;
  fadeShadowMs: number;
}

export const Motion: MotionTokens = {
  entryCurve: [0.16, 1, 0.3, 1],
  interactionCurve: [0.2, 0.8, 0.2, 1],
  entryKeyArtMs: 760,
  entryCopyMs: 620,
  entryCopyDelayMs: 90,
  entryPrimaryActionMs: 620,
  entryPrimaryActionDelayMs: 180,
  entryRailsMs: 700,
  entryRailsDelayMs: 120,
  drawerMs: 280,
  interactionCardMs: 220,
  interactionTitleCardMs: 260,
  interactionNavExpandMs: 280,
  fadeOpacityMs: 180,
  fadeColorMs: 220,
  fadeShadowMs: 240,
};

/** Brief 5.9 ("TV stage geometry", 1920x1080) plus the TV column of 5.10
 * ("Card and rail metrics") plus the TV overscan insets from 5.5.
 *
 * Percentage-suffixed fields (`*Pct`) are literal CSS percentages copied
 * as-is (e.g. `52%` -> `52`). Ratio-suffixed fields (`*Ratio`) and plain
 * opacity fields are literal 0-1 fractions copied as-is (e.g. `0.39` ->
 * `0.39`) -- each field's suffix documents which scale its source used so
 * no value has been renormalised.
 */
export interface TvGeometryTokens {
  // Overscan insets (5.5), baked at 1920x1080.
  screenX: number;
  screenY: number;
  headerHeight: number;

  // Key art image.
  keyArtWidthPct: number;
  keyArtWidthPx: number;
  keyArtHeightPct: number;
  keyArtHeightPx: number;
  keyArtOffsetY: number;
  keyArtScale: number;
  keyArtObjectPositionYPct: number;
  keyArtMaskFadeStartPct: number;

  // Key-art scrims.
  keyArtScrimHorizontalFadePct: number;
  keyArtScrimVerticalFadeInPct: number;
  keyArtScrimVerticalFadeOutStartPct: number;

  // Stage wash.
  stageWashLeftOpacityPct: number;
  stageWashLeftFadePct: number;
  stageWashRightOpacityPct: number;
  stageWashRightFadePct: number;

  // Title panel.
  titlePanelTopPct: number;
  titlePanelLeft: number;
  titlePanelWidth: number;

  // Primary action.
  primaryActionTopPct: number;
  primaryActionLeftPct: number;
  primaryActionSize: number;

  // Rail panel.
  railPanelTopPct: number;
  railPanelRightPct: number;
  railPanelWidth: number;
  railPanelLeft: number;
  railPanelMinHeight: number;
  railPanelPadding: number;

  // Home rails column.
  homeRailsColumnLeftPct: number;
  homeRailsColumnVerticalPaddingVhPct: number;
  homeRailsColumnRowGap: number;

  // Utility/clock row.
  utilityRowTop: number;
  utilityRowHeight: number;

  // Logo.
  logoSize: number;
  logoLeft: number;
  logoTop: number;

  // 5.10 card and rail metrics, TV column.
  homeRailCardWidthLandscape: number;
  homeRailCardWidthCover: number;
  railPanelCardWidth: number;
  railItemGapHome: number;
  railItemGapTitle: number;
  railHeadingSize: number;
  railHeadingWeight: number;
  libraryGridColumns: number;
  libraryGridRowGap: number;
  libraryGridColumnGap: number;
  libraryGridCardRadius: number;
  azIndexRailRight: number;
  azIndexRailHeightVhPct: number;
  azIndexRailHeightMaxPx: number;
  azIndexButtonSize: number;
  detailBackdropLeftPct: number;
  detailCopyColumnWidthRatio: number;
  detailCopyColumnStart: number;
  detailCopyColumnTop: number;
  detailBrowserWidthRatio: number;
  detailBrowserHeightRatio: number;
  detailBrowserEnd: number;
  libraryBackdropLeftPct: number;
  libraryResultsWidthRatio: number;
  libraryResultsBackgroundOpacity: number;
  navStart: number;
  navGroupRadius: number;
  navGroupBackgroundOpacity: number;
  navGroupBorderWidth: number;
  navGroupBorderOpacity: number;
  navGroupShadow: number;
  navGroupPaddingH: number;
  navGroupPaddingV: number;
  navGroupItemGap: number;
  navTileSize: number;
  navTileRadius: number;
  navTileIconSize: number;
  navTileLabelSize: number;
  navTileLabelWeight: number;
  navGroupTop: number;
  navGroupShadowOffsetY: number;
  playerControlBarPaddingH: number;
  playerControlBarTitleSize: number;
  playerControlBarPlayIconSize: number;
  playerControlBarGap: number;
  playerControlBarTopButtonSize: number;
  playerAutoHideMs: number;
}

export const TvGeometry: TvGeometryTokens = {
  screenX: 86,
  screenY: 38,
  headerHeight: 92,

  keyArtWidthPct: 52,
  keyArtWidthPx: 998,
  keyArtHeightPct: 106,
  keyArtHeightPx: 1145,
  keyArtOffsetY: -33,
  keyArtScale: 1.04,
  keyArtObjectPositionYPct: 20,
  keyArtMaskFadeStartPct: 72,

  keyArtScrimHorizontalFadePct: 22,
  keyArtScrimVerticalFadeInPct: 22,
  keyArtScrimVerticalFadeOutStartPct: 82,

  stageWashLeftOpacityPct: 94,
  stageWashLeftFadePct: 31,
  stageWashRightOpacityPct: 50,
  stageWashRightFadePct: 34,

  titlePanelTopPct: 31,
  titlePanelLeft: 144,
  titlePanelWidth: 518,

  primaryActionTopPct: 47,
  primaryActionLeftPct: 47.5,
  primaryActionSize: 115,

  railPanelTopPct: 24,
  railPanelRightPct: 3.8,
  railPanelWidth: 864,
  railPanelLeft: 983,
  railPanelMinHeight: 421,
  railPanelPadding: 58,

  homeRailsColumnLeftPct: 38,
  homeRailsColumnVerticalPaddingVhPct: 50,
  homeRailsColumnRowGap: 48,

  utilityRowTop: 56,
  utilityRowHeight: 50,

  logoSize: 42,
  logoLeft: 59,
  logoTop: 34,

  homeRailCardWidthLandscape: 219,
  homeRailCardWidthCover: 172,
  railPanelCardWidth: 230,
  railItemGapHome: 25,
  railItemGapTitle: 23,
  railHeadingSize: 18,
  railHeadingWeight: 610,
  libraryGridColumns: 3,
  libraryGridRowGap: 36,
  libraryGridColumnGap: 28,
  libraryGridCardRadius: 12,
  azIndexRailRight: 22,
  azIndexRailHeightVhPct: 66,
  azIndexRailHeightMaxPx: 720,
  azIndexButtonSize: 24,
  detailBackdropLeftPct: 55,
  detailCopyColumnWidthRatio: 0.39,
  detailCopyColumnStart: 154,
  detailCopyColumnTop: 224,
  detailBrowserWidthRatio: 0.57,
  detailBrowserHeightRatio: 0.72,
  detailBrowserEnd: 50,
  libraryBackdropLeftPct: 52,
  libraryResultsWidthRatio: 0.65,
  libraryResultsBackgroundOpacity: 0.93,
  navStart: 42,
  navGroupRadius: 22,
  navGroupBackgroundOpacity: 0.56,
  navGroupBorderWidth: 1,
  navGroupBorderOpacity: 0.053,
  navGroupShadow: 42,
  navGroupPaddingH: 7,
  navGroupPaddingV: 8,
  navGroupItemGap: 9,
  navTileSize: 64,
  navTileRadius: 16,
  navTileIconSize: 20,
  navTileLabelSize: 8.832,
  navTileLabelWeight: 680,
  // Web TV library group (Home, Series, Movies, Music) top edge; the Downloads/Search group sits above it on web.
  navGroupTop: 286,
  navGroupShadowOffsetY: 14,
  playerControlBarPaddingH: 48,
  playerControlBarTitleSize: 19,
  playerControlBarPlayIconSize: 34,
  playerControlBarGap: 10,
  playerControlBarTopButtonSize: 48,
  playerAutoHideMs: 3500,
};

/** Brief 5.10 -- "Card and rail metrics", Touch column only. Rows with no
 * touch value ("--"/"not shown") -- rail-panel card width, the A-Z index
 * rail -- have no field here. */
export interface TouchGeometryTokens {
  homeRailCardWidthLandscape: number;
  homeRailCardWidthCover: number;
  railItemGap: number;
  railHeadingSize: number;
  libraryGridAdaptiveMin: number;
  libraryGridAdaptiveMid: number;
  libraryGridAdaptiveMax: number;
  detailListTop: number;
  detailListItemHeight: number;
  detailListBottom: number;
  detailListSpacing: number;
  libraryGridTop: number;
  libraryGridBottom: number;
  navPaddingH: number;
  navPaddingV: number;
  navBackgroundOpacity: number;
  navRadius: number;
  navShadow: number;
  navRowPadding: number;
  navRowGap: number;
  navItemHeight: number;
  navItemRadius: number;
  navItemPaddingH: number;
  navIconOnlySize: number;
  playerControlBarPadding: number;
  playerControlBarPlayIconSize: number;
  playerControlBarTopButtonSize: number;
  playerAutoHideMs: number;
}

export const TouchGeometry: TouchGeometryTokens = {
  homeRailCardWidthLandscape: 150,
  homeRailCardWidthCover: 118,
  railItemGap: 12,
  railHeadingSize: 16,
  libraryGridAdaptiveMin: 132,
  libraryGridAdaptiveMid: 164,
  libraryGridAdaptiveMax: 206,
  detailListTop: 245,
  detailListItemHeight: 16,
  detailListBottom: 112,
  detailListSpacing: 18,
  libraryGridTop: 28,
  libraryGridBottom: 104,
  navPaddingH: 10,
  navPaddingV: 8,
  navBackgroundOpacity: 0.94,
  navRadius: 20,
  navShadow: 18,
  navRowPadding: 5,
  navRowGap: 2,
  navItemHeight: 46,
  navItemRadius: 16,
  navItemPaddingH: 12,
  navIconOnlySize: 21,
  playerControlBarPadding: 18,
  playerControlBarPlayIconSize: 28,
  playerControlBarTopButtonSize: 44,
  playerAutoHideMs: 3500,
};

/** An {r,g,b} colour point (no alpha) used only for avatar gradients. */
export interface AvatarGradientPoint {
  r: number;
  g: number;
  b: number;
}

/** Brief 5.11 -- avatar presets. `AvatarPreset.ts` (a separate file) must
 * hash a userId to pick one of these six entries bit-for-bit identically
 * to tv-web; this table only holds the gradient data. */
export interface AvatarPreset {
  id: string;
  gradientStart: AvatarGradientPoint;
  gradientEnd: AvatarGradientPoint;
}

export const AvatarPresets: AvatarPreset[] = [
  {
    id: "astronaut",
    gradientStart: { r: 82, g: 103, b: 173 },
    gradientEnd: { r: 34, g: 45, b: 95 },
  },
  {
    id: "cat",
    gradientStart: { r: 227, g: 124, b: 104 },
    gradientEnd: { r: 156, g: 63, b: 102 },
  },
  {
    id: "dinosaur",
    gradientStart: { r: 85, g: 164, b: 110 },
    gradientEnd: { r: 35, g: 114, b: 101 },
  },
  {
    id: "robot",
    gradientStart: { r: 93, g: 156, b: 175 },
    gradientEnd: { r: 54, g: 83, b: 131 },
  },
  {
    id: "pirate",
    gradientStart: { r: 211, g: 154, b: 72 },
    gradientEnd: { r: 145, g: 70, b: 76 },
  },
  {
    id: "alien",
    gradientStart: { r: 139, g: 113, b: 197 },
    gradientEnd: { r: 74, g: 71, b: 127 },
  },
];
