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
import { activeColors, toResourceColor, toResourceColorWithAlpha } from '../Theme';
import type { ThemeModeSetting } from '../Theme';
import { tv } from '../Metrics';
import { TvGeometry } from '../../core/Tokens';
import {
  ENTRY_CURVE,
  ENTRY_KEY_ART_MS,
  ENTRY_COPY_MS,
  ENTRY_COPY_DELAY_MS,
  ENTRY_RAILS_MS,
  ENTRY_RAILS_DELAY_MS,
} from '../Motion';
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

/** Converts a brief `*Pct` field (a literal CSS percentage, e.g. `22` for
 * `22%`) to the 0-1 fraction ArkUI's gradient `colors` stop offsets use. */
function pct100(value: number): number {
  return value / 100;
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
  @State private railsEntry: number = 0;


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
      { duration: ENTRY_RAILS_MS, delay: ENTRY_RAILS_DELAY_MS, curve: ENTRY_CURVE },
      () => {
        this.railsEntry = 1;
      }
    );
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
    .position({ x: tv(TvGeometry.titlePanelLeft), y: tv(TvGeometry.titlePanelTop) })
    .opacity(this.copyEntry)
    .translate({ x: -tv(COPY_ENTRY_TRANSLATE_X) * (1 - this.copyEntry) })
  }

  // Web TV Home has no panel behind the rails: a plain full-height column (`.tv-home-rails`).
  @Builder
  private railPanelLayer(): void {
    Column() {
      this.railsSlot()
    }
    .width(tv(TvGeometry.homeRailsWidth))
    .height('100%')
    .alignItems(HorizontalAlign.Start)
    .padding({ left: tv(TvGeometry.homeRailsInsetLeft), top: tv(TvGeometry.homeRailsTop) })
    .position({ x: tv(TvGeometry.homeRailsLeft), y: 0 })
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
    }
    .width('100%')
    .height('100%')
    .alignContent(Alignment.TopStart)
    .backgroundColor(toResourceColor(activeColors().surface))
  }
}
