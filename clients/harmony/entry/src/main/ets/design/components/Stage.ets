/**
 * The TV editorial hero stage (brief section 5.9, "TV stage geometry",
 * 1920x1080), composed from key art, four decorative gradient layers, a
 * positioned title panel (hosting `FeatureCopy`), a positioned primary
 * play action, and a positioned glass rail panel that hosts a
 * caller-supplied rails slot.
 *
 * This component fills 100% of whatever space its caller gives it and
 * treats that as the full 1920x1080 design canvas -- every element below
 * is positioned/sized from Stage's own top-left (0,0), matching brief
 * 5.9's numbers directly (they are not offset by the separate TV overscan
 * insets in brief 5.5/`TvGeometry.screenX`/`screenY`, which the source CSS
 * applies at a different level -- `.tv-home`/`.tv-key-art` are themselves
 * full-bleed `inset: 0`, and `.tv-title-panel`'s own 144px left offset is
 * already measured from that true edge). Applying overscan safe-area
 * padding, if any, is the hosting page/shell's job, not this component's.
 *
 * Every raw 1920-space number from `core/Tokens.ts`'s `TvGeometry` table
 * is wrapped in `design/Metrics.ets`'s `tv()` before use, per this file's
 * brief. Percentage fields (`*Pct`) are used as literal ArkUI percentage
 * strings instead -- they are already resolution-independent and need no
 * scaling.
 *
 * ## Rail panel vs. the home rails column
 *
 * `TvGeometry` also carries a `homeRailsColumn*` field group (left 38%,
 * 50vh vertical padding, 48 row gap) that does NOT appear here. Brief
 * 5.9's own cross-check paragraph ("Android's baked equivalents...rails
 * column fillMaxWidth(0.62)...") describes a *different*, much taller
 * full-height multi-rail region than the compact glass `railPanel*`
 * geometry (top 24%/right 3.8%/width 864/min-height 421/padding 58/radius
 * 2) that brief 5.9's own table row names "rail panel" and this file's own
 * brief explicitly calls out by that name. This component positions the
 * glass "rail panel" card per that literal geometry and places the
 * caller's rails-column slot content inside it; reconciling the wider
 * `homeRailsColumn*` figures against whatever the Home page slice actually
 * needs is deliberately left to that later slice, not duplicated here.
 *
 * ## Glass recipe (brief 5.6) and entry-transform "from" values (brief 5.7)
 *
 * Neither has a `core/Tokens.ts` field (no shadow/blur/entry-transform
 * table exists there), so they are named constants below, the same
 * documented exception `design/components/Skeleton.ets`/`AsyncState.ets`
 * use for brief literals absent from `core/Tokens.ts`.
 *
 * ## Known, deliberate divergences
 *
 * - `object-position: center 20%` (`TvGeometry.keyArtObjectPositionYPct`)
 *   has no ArkUI equivalent: `ImageFit.Cover` always crops from centre,
 *   with no per-axis anchor control. Not applied; recorded here rather
 *   than faked with a fragile manual-crop hack, the same tolerance brief
 *   5.6 itself grants the backdrop-blur fallback.
 * - CSS's `mask-image` (a true alpha mask on the raw `<img>`) is
 *   reproduced as an alpha-overlay gradient drawn on top of the key art
 *   using the stage's own `surface` colour (the colour the mask reveals,
 *   per `.tv-home`'s own `background: var(--surface)`) -- visually
 *   equivalent, since ArkUI's `Image` has no `mask-image` analogue.
 * - `backdrop-filter: blur(...) saturate(...)`'s `saturate()` component
 *   has no ArkUI backdrop equivalent (`.saturate()` only affects a
 *   component's own content, not what is sampled behind it via
 *   `.backdropBlur()`); only the blur is reproduced.
 */

import { image } from '@kit.ImageKit';
import { activeColors, toResourceColor, toResourceColorWithAlpha, resolvedThemeMode } from '../Theme';
import type { ThemeModeSetting } from '../Theme';
import { tv } from '../Metrics';
import { TvGeometry, Radii } from '../../core/Tokens';
import type { RgbaColor } from '../../core/Tokens';
import {
  ENTRY_CURVE,
  INTERACTION_CURVE,
  ENTRY_KEY_ART_MS,
  ENTRY_COPY_MS,
  ENTRY_COPY_DELAY_MS,
  ENTRY_PRIMARY_ACTION_MS,
  ENTRY_PRIMARY_ACTION_DELAY_MS,
  ENTRY_RAILS_MS,
  ENTRY_RAILS_DELAY_MS,
  INTERACTION_NAV_EXPAND_MS,
} from '../Motion';
import { FOCUS_LIFT, effectiveFocusPercent, DEFAULT_ACTIVE_RAIL_FACTOR } from './FocusLift';
import { FeatureCopy } from './FeatureCopy';

/** Gradient angles (brief 5.9), ArkUI's `linearGradient({angle})` uses the
 * same 0=up/clockwise convention as the source CSS `linear-gradient()`
 * (confirmed by `Skeleton.ets` already porting its own `100deg` verbatim),
 * so every angle below is copied unchanged, no conversion. */
const HORIZONTAL_ANGLE: number = 90;
const VERTICAL_ANGLE: number = 0;
const WASH_RIGHT_ANGLE: number = 270;

/** Brief 5.7 -- entry "from" transforms. Not in `core/Tokens.ts`'s
 * `MotionTokens` (that table only holds durations/delays/curves). */
const KEY_ART_ENTRY_TRANSLATE_X_PCT: number = 0.025; // translateX(-2.5%) of the key art's own width
const KEY_ART_ENTRY_SCALE_FROM: number = 1.06;
const KEY_ART_ENTRY_BLUR_FROM: number = 12;
const COPY_ENTRY_TRANSLATE_X: number = 34; // translateX(-34px)
const RAILS_ENTRY_TRANSLATE_X: number = 60; // translateX(60px)
const PRIMARY_ACTION_ENTRY_SCALE_FROM: number = 0.65;

/** Brief 5.6 -- glass recipes. Not in `core/Tokens.ts` (no shadow/blur
 * table exists there). */
const RAIL_PANEL_BLUR_RADIUS: number = 30;
const RAIL_PANEL_SURFACE_OPACITY_LIGHT: number = 0.72;
const RAIL_PANEL_SURFACE_OPACITY_DARK: number = 0.76;
const RAIL_PANEL_HAIRLINE_ALPHA: number = 0.22;
const RAIL_PANEL_SHADOW_OFFSET_Y: number = 30;
const RAIL_PANEL_SHADOW_RADIUS: number = 90;
const RAIL_PANEL_SHADOW_ALPHA: number = 0.08;

const PRIMARY_ACTION_BLUR_RADIUS: number = 22;
const PRIMARY_ACTION_SURFACE_OPACITY: number = 0.92;
const PRIMARY_ACTION_HAIRLINE_ALPHA: number = 0.62;
const PRIMARY_ACTION_SHADOW_OFFSET_Y: number = 26;
const PRIMARY_ACTION_SHADOW_RADIUS: number = 65;
const PRIMARY_ACTION_SHADOW_ALPHA: number = 0.2;

/** Primary-action play glyph: not in the brief's own tables at all.
 * Derived from `.tv-primary-action span { font-size: clamp(1rem, 1.35vw,
 * 1.65rem); margin-left: 0.14em }` in global.css, evaluated at 1920px the
 * same way this file's sibling `FeatureCopy.ets` derives its synopsis
 * size: the preferred branch (`1.35vw` @ 1920 = 25.92) and the upper-bound
 * branch (`1.65rem` * 16 = 26.4) both round to 26. */
const PRIMARY_ACTION_GLYPH_SIZE: number = 26;
const PRIMARY_ACTION_GLYPH_NUDGE_X: number = PRIMARY_ACTION_GLYPH_SIZE * 0.14;

const HAIRLINE_WHITE: RgbaColor = { r: 255, g: 255, b: 255, a: 1 };

/** Converts a brief `*Pct` field (a literal CSS percentage, e.g. `22` for
 * `22%`) to the 0-1 fraction ArkUI's gradient `colors` stop offsets use. */
function pct100(value: number): number {
  return value / 100;
}

function lerpChannel(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}

/** Per-channel (including alpha) linear interpolation between two
 * `RgbaColor` records, returned as an ArkUI `rgba(...)` resource-colour
 * string -- used to crossfade the primary action's glass background to
 * `ink` and its glyph colour to `bg` on focus (brief 5.8: "primary play
 * action | scale(1.16), background -> ink, content -> bg"). */
function lerpColor(from: RgbaColor, to: RgbaColor, t: number): string {
  return toResourceColor({
    r: Math.round(lerpChannel(from.r, to.r, t)),
    g: Math.round(lerpChannel(from.g, to.g, t)),
    b: Math.round(lerpChannel(from.b, to.b, t)),
    a: lerpChannel(from.a, to.a, t),
  });
}

@Component
export struct Stage {
  /** The featured work's key art. Defaults to the brand mark as a safe
   * placeholder before real artwork resolves -- callers should always
   * pass real key art once available.
   *
   * Widened from `ResourceStr` alone to also accept `image.PixelMap`
   * (brief 4.9 / 9 Slice 6): hero artwork is bearer-gated and can only ever
   * reach a caller as a decoded `PixelMap` from `data/ArtworkRepository.ets`
   * (`fetchWorkArtworkByPriority(workId, HERO_ARTWORK_PRIORITY)`), never as
   * a `$r(...)` resource, so a Home-page-shaped caller has no way to supply
   * real key art at all unless this prop accepts one. `ArkUI`'s own
   * `Image()` component already accepts a `PixelMap` natively -- see
   * `keyArtLayer()` below, which passes `this.keyArt` straight through
   * unchanged -- so this is a type-only widening with no behavioural
   * change for the one existing caller (`pages/DesignGallery.ets`), which
   * never sets this prop and keeps rendering the default logo placeholder. */
  @Prop keyArt: ResourceStr | image.PixelMap = $r('app.media.playarr_logo');
  /** Passed straight through to the composed `FeatureCopy`. */
  @Prop kicker: string = '';
  @Prop title: string = '';
  @Prop metaLines: string[] = [];
  @Prop synopsis: string = '';
  /** Called when the primary play action is activated. Plain
   * (non-reactive) callback field -- functions are not observable state,
   * same documented pattern as `AsyncState.ets`'s `retry` field. */
  onPlay: () => void = () => {};

  // Tracked purely to force a re-render on theme / TV-scale change; the
  // actual values always go through design/Theme.ets's resolvers and
  // design/Metrics.ets's tv() below (see those files' own header comments
  // for this exact pattern).
  @StorageProp('colorMode') private sysColorMode: ColorMode = ColorMode.LIGHT;
  @StorageProp('themeModeSetting') private themeSetting: ThemeModeSetting = 'system';
  @StorageProp('tvScaleFactor') private trackedTvScale: number = 1;

  // Entry-reveal progress, 0..1, one per staggered element (brief 5.7).
  @State private keyArtEntry: number = 0;
  @State private copyEntry: number = 0;
  @State private primaryActionEntry: number = 0;
  @State private railsEntry: number = 0;

  @State private primaryActionFocusPercent: number = 0;

  /** Default rails slot: nothing, until the caller supplies real content
   * (a later slice's Home page, with its own `MediaRail` instances) --
   * Stage never imports `MediaRail` itself, per this component's brief. */
  @Builder
  private emptyRailsSlot(): void {}

  @BuilderParam railsSlot: () => void = this.emptyRailsSlot;

  aboutToAppear(): void {
    this.getUIContext().animateTo({ duration: ENTRY_KEY_ART_MS, curve: ENTRY_CURVE }, () => {
      this.keyArtEntry = 1;
    });
    this.getUIContext().animateTo(
      { duration: ENTRY_COPY_MS, delay: ENTRY_COPY_DELAY_MS, curve: ENTRY_CURVE },
      () => {
        this.copyEntry = 1;
      }
    );
    this.getUIContext().animateTo(
      { duration: ENTRY_PRIMARY_ACTION_MS, delay: ENTRY_PRIMARY_ACTION_DELAY_MS, curve: ENTRY_CURVE },
      () => {
        this.primaryActionEntry = 1;
      }
    );
    this.getUIContext().animateTo(
      { duration: ENTRY_RAILS_MS, delay: ENTRY_RAILS_DELAY_MS, curve: ENTRY_CURVE },
      () => {
        this.railsEntry = 1;
      }
    );
  }

  private setPrimaryActionFocused(focused: boolean): void {
    this.getUIContext().animateTo({ duration: INTERACTION_NAV_EXPAND_MS, curve: INTERACTION_CURVE }, () => {
      this.primaryActionFocusPercent = focused ? 1 : 0;
    });
  }

  private railPanelSurfaceOpacity(): number {
    if (resolvedThemeMode() === 'dark') {
      return RAIL_PANEL_SURFACE_OPACITY_DARK;
    }
    return RAIL_PANEL_SURFACE_OPACITY_LIGHT;
  }

  private primaryActionBackgroundColor(): string {
    const from: RgbaColor = {
      r: activeColors().surfaceStrong.r,
      g: activeColors().surfaceStrong.g,
      b: activeColors().surfaceStrong.b,
      a: PRIMARY_ACTION_SURFACE_OPACITY,
    };
    return lerpColor(from, activeColors().ink, this.primaryActionFocusPercent);
  }

  private primaryActionGlyphColor(): string {
    return lerpColor(activeColors().ink, activeColors().bg, this.primaryActionFocusPercent);
  }

  @Builder
  private keyArtLayer(): void {
    Stack() {
      Image(this.keyArt)
        .width(tv(TvGeometry.keyArtWidthPx))
        .height(tv(TvGeometry.keyArtHeightPx))
        .objectFit(ImageFit.Cover)
        .scale({ x: TvGeometry.keyArtScale, y: TvGeometry.keyArtScale })
        .draggable(false)
        .focusable(false)

      // Alpha-overlay reproduction of the source CSS's `mask-image`
      // (see this file's header comment): visible until 72% of the key
      // art's own width, then fading to the stage's `surface` colour.
      Row()
        .width(tv(TvGeometry.keyArtWidthPx))
        .height(tv(TvGeometry.keyArtHeightPx))
        .linearGradient({
          angle: HORIZONTAL_ANGLE,
          colors: [
            [toResourceColorWithAlpha(activeColors().surface, 0), 0],
            [toResourceColorWithAlpha(activeColors().surface, 0), pct100(TvGeometry.keyArtMaskFadeStartPct)],
            [toResourceColorWithAlpha(activeColors().surface, 1), 1],
          ],
        })
    }
    .width(tv(TvGeometry.keyArtWidthPx))
    .height(tv(TvGeometry.keyArtHeightPx))
    .position({ x: 0, y: tv(TvGeometry.keyArtOffsetY) })
    .clip(true)
    .hitTestBehavior(HitTestMode.Transparent)
    .opacity(this.keyArtEntry)
    .translate({ x: -(1 - this.keyArtEntry) * KEY_ART_ENTRY_TRANSLATE_X_PCT * tv(TvGeometry.keyArtWidthPx) })
    .scale({
      x: 1 + (KEY_ART_ENTRY_SCALE_FROM - 1) * (1 - this.keyArtEntry),
      y: 1 + (KEY_ART_ENTRY_SCALE_FROM - 1) * (1 - this.keyArtEntry),
    })
    .blur(tv(KEY_ART_ENTRY_BLUR_FROM) * (1 - this.keyArtEntry))
  }

  // Brief 5.9 -- "key-art scrims": two full-stage overlays over the key
  // art (horizontal, then a top+bottom vertical vignette).
  @Builder
  private horizontalScrimLayer(): void {
    Row()
      .width('100%')
      .height('100%')
      .position({ x: 0, y: 0 })
      .hitTestBehavior(HitTestMode.Transparent)
      .linearGradient({
        angle: HORIZONTAL_ANGLE,
        colors: [
          [toResourceColor(activeColors().surface), 0],
          [toResourceColorWithAlpha(activeColors().surface, 0), pct100(TvGeometry.keyArtScrimHorizontalFadePct)],
        ],
      })
  }

  @Builder
  private verticalScrimLayer(): void {
    Row()
      .width('100%')
      .height('100%')
      .position({ x: 0, y: 0 })
      .hitTestBehavior(HitTestMode.Transparent)
      .linearGradient({
        angle: VERTICAL_ANGLE,
        colors: [
          [toResourceColor(activeColors().surface), 0],
          [toResourceColorWithAlpha(activeColors().surface, 0), pct100(TvGeometry.keyArtScrimVerticalFadeInPct)],
          [
            toResourceColorWithAlpha(activeColors().surface, 0),
            pct100(TvGeometry.keyArtScrimVerticalFadeOutStartPct),
          ],
          [toResourceColor(activeColors().surface), 1],
        ],
      })
  }

  // Brief 5.9 -- "stage wash": two full-stage overlays, left (heavier) and
  // right (lighter), framing the copy/rail-panel columns.
  @Builder
  private stageWashLeftLayer(): void {
    Row()
      .width('100%')
      .height('100%')
      .position({ x: 0, y: 0 })
      .hitTestBehavior(HitTestMode.Transparent)
      .linearGradient({
        angle: HORIZONTAL_ANGLE,
        colors: [
          [toResourceColorWithAlpha(activeColors().surface, pct100(TvGeometry.stageWashLeftOpacityPct)), 0],
          [toResourceColorWithAlpha(activeColors().surface, 0), pct100(TvGeometry.stageWashLeftFadePct)],
        ],
      })
  }

  @Builder
  private stageWashRightLayer(): void {
    Row()
      .width('100%')
      .height('100%')
      .position({ x: 0, y: 0 })
      .hitTestBehavior(HitTestMode.Transparent)
      .linearGradient({
        angle: WASH_RIGHT_ANGLE,
        colors: [
          [toResourceColorWithAlpha(activeColors().surface, pct100(TvGeometry.stageWashRightOpacityPct)), 0],
          [toResourceColorWithAlpha(activeColors().surface, 0), pct100(TvGeometry.stageWashRightFadePct)],
        ],
      })
  }

  @Builder
  private titlePanelLayer(): void {
    Column() {
      FeatureCopy({
        kicker: this.kicker,
        title: this.title,
        metaLines: this.metaLines,
        synopsis: this.synopsis,
      })
    }
    .width(tv(TvGeometry.titlePanelWidth))
    .position({ x: tv(TvGeometry.titlePanelLeft), y: `${TvGeometry.titlePanelTopPct}%` })
    .opacity(this.copyEntry)
    .translate({ x: -tv(COPY_ENTRY_TRANSLATE_X) * (1 - this.copyEntry) })
  }

  @Builder
  private primaryActionLayer(): void {
    Stack() {
      Text('▶')
        .fontSize(tv(PRIMARY_ACTION_GLYPH_SIZE))
        .fontColor(this.primaryActionGlyphColor())
        .offset({ x: tv(PRIMARY_ACTION_GLYPH_NUDGE_X) })
    }
    .width(tv(TvGeometry.primaryActionSize))
    .height(tv(TvGeometry.primaryActionSize))
    .alignContent(Alignment.Center)
    .borderRadius(Radii.circleFull)
    .clip(true)
    .backgroundColor(this.primaryActionBackgroundColor())
    .backdropBlur(tv(PRIMARY_ACTION_BLUR_RADIUS))
    .border({ width: tv(1), color: toResourceColorWithAlpha(HAIRLINE_WHITE, PRIMARY_ACTION_HAIRLINE_ALPHA) })
    .shadow({
      radius: tv(PRIMARY_ACTION_SHADOW_RADIUS),
      color: toResourceColorWithAlpha(activeColors().ink, PRIMARY_ACTION_SHADOW_ALPHA),
      offsetX: 0,
      offsetY: tv(PRIMARY_ACTION_SHADOW_OFFSET_Y),
    })
    .position({ x: `${TvGeometry.primaryActionLeftPct}%`, y: `${TvGeometry.primaryActionTopPct}%` })
    .markAnchor({ x: '50%', y: '50%' })
    .focusable(true)
    .onFocus(() => {
      this.setPrimaryActionFocused(true);
    })
    .onBlur(() => {
      this.setPrimaryActionFocused(false);
    })
    .onClick(() => {
      this.onPlay();
    })
    .opacity(this.primaryActionEntry)
    .scale({
      x:
        (PRIMARY_ACTION_ENTRY_SCALE_FROM + (1 - PRIMARY_ACTION_ENTRY_SCALE_FROM) * this.primaryActionEntry) *
        (1 +
          (FOCUS_LIFT.primaryPlayAction.scale - 1) *
            effectiveFocusPercent(this.primaryActionFocusPercent, DEFAULT_ACTIVE_RAIL_FACTOR)),
      y:
        (PRIMARY_ACTION_ENTRY_SCALE_FROM + (1 - PRIMARY_ACTION_ENTRY_SCALE_FROM) * this.primaryActionEntry) *
        (1 +
          (FOCUS_LIFT.primaryPlayAction.scale - 1) *
            effectiveFocusPercent(this.primaryActionFocusPercent, DEFAULT_ACTIVE_RAIL_FACTOR)),
    })
  }

  @Builder
  private railPanelLayer(): void {
    Column() {
      this.railsSlot()
    }
    .width(tv(TvGeometry.railPanelWidth))
    .constraintSize({ minHeight: tv(TvGeometry.railPanelMinHeight) })
    .padding(tv(TvGeometry.railPanelPadding))
    .borderRadius(Radii.railPanel)
    .clip(true)
    .backgroundColor(toResourceColorWithAlpha(activeColors().surfaceStrong, this.railPanelSurfaceOpacity()))
    .backdropBlur(tv(RAIL_PANEL_BLUR_RADIUS))
    .border({ width: tv(1), color: toResourceColorWithAlpha(HAIRLINE_WHITE, RAIL_PANEL_HAIRLINE_ALPHA) })
    .shadow({
      radius: tv(RAIL_PANEL_SHADOW_RADIUS),
      color: toResourceColorWithAlpha(activeColors().ink, RAIL_PANEL_SHADOW_ALPHA),
      offsetX: 0,
      offsetY: tv(RAIL_PANEL_SHADOW_OFFSET_Y),
    })
    .position({ x: tv(TvGeometry.railPanelLeft), y: `${TvGeometry.railPanelTopPct}%` })
    .opacity(this.railsEntry)
    .translate({ x: tv(RAILS_ENTRY_TRANSLATE_X) * (1 - this.railsEntry) })
  }

  build() {
    Stack() {
      this.keyArtLayer()
      this.horizontalScrimLayer()
      this.verticalScrimLayer()
      this.stageWashLeftLayer()
      this.stageWashRightLayer()
      this.titlePanelLayer()
      this.railPanelLayer()
      this.primaryActionLayer()
    }
    .width('100%')
    .height('100%')
    .alignContent(Alignment.TopStart)
    .backgroundColor(toResourceColor(activeColors().surface))
  }
}
