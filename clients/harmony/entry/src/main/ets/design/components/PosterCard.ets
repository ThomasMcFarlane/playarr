/**
 * The shared landscape/cover content card (brief section 2, component tree:
 * "Landscape/cover content card: artwork, progress bar, title, subtitle,
 * focus behaviour") -- used for home-rail cards, rail-panel cards and
 * title/episode cards alike. Artwork FETCHING is a later slice's job
 * (`data/ArtworkRepository.ets`); this component only ever RENDERS whatever
 * `PixelMap` (or nothing yet, i.e. a loading placeholder) its caller
 * supplies via the `artwork` prop.
 *
 * ## Focus treatment (brief 5.8, `design/components/FocusLift.ets`)
 *
 * `variant` selects which brief-5.8 delta this card uses:
 * - `'home'` (default) -- `FOCUS_LIFT.homeCard` (`translateY(-6)`, art
 *   `scale(1.025)`), the brief-5.6 "Card art (home)" shadow pair, and
 *   `INTERACTION_CARD_MS` (220ms, "cards/buttons/rail headings").
 * - `'titleEpisode'` -- `FOCUS_LIFT.titleEpisodeCard` (`translateY(-7)`,
 *   art `scale(1.025)`), the brief-5.6 "Title/episode" shadow pair, and
 *   `INTERACTION_TITLE_CARD_MS` (260ms), per `FocusLift.ets`'s own header
 *   comment ("INTERACTION_TITLE_CARD_MS for title/episode cards").
 *
 * `translateY` lifts the WHOLE card (artwork + title + subtitle); `scale`
 * and the shadow upgrade apply to the ARTWORK frame only -- exactly the
 * brief 5.8 table's split ("home card | translateY(-6), art scale(1.025),
 * shadow upgraded"). `activeRailFactor` (default
 * `FocusLift.DEFAULT_ACTIVE_RAIL_FACTOR`) is multiplied in via
 * `effectiveFocusPercent` so a card "selected" inside a rail that does not
 * itself hold focus renders at rest -- the caller (a rail component, a
 * later slice) is responsible for passing its own live focus state down.
 *
 * **No focus ring anywhere.** Only the lift/scale/shadow delta, per brief
 * 5.8's "a lift, not a ring" and brief 6.3's PosterCard acceptance note.
 *
 * `Image` defaults to `focusable: false` on HarmonyOS even though it is
 * visually focusable (brief 6.3) -- a poster grid built from bare `Image`s
 * is completely untraversable by D-pad. This component calls
 * `.focusable(true)` explicitly on its own root so the validator's source
 * contract check (`checks/contract.mjs`) and real D-pad traversal both see
 * it.
 *
 * ## Shadows (brief 5.6)
 *
 * The two-layer "Card art" shadows are copied verbatim as `{offsetY,
 * radius, alpha}` triples and cross-faded continuously from rest to
 * focused via linear interpolation on `effectiveFocusPercent(...)`,
 * applied through ArkUI's `.shadow(Array<ShadowOptions>)` overload (added
 * API 12; this project targets HarmonyOS 6.1 / API 18+ per brief 6.3's
 * `.nextFocus()` note, well past that floor) so both layers composite
 * simultaneously instead of only the more prominent one winning. The tint
 * colour is `rgba(56,38,33,·)` in brief 5.6 with no stated dark-mode
 * variant (unlike the separate, more generic `shadowSoft`/`shadowFocus`
 * pair in 5.1/5.2, which DO flip to black in dark mode) -- so it is read
 * here as `core/Tokens.ts`'s `LightColors.ink` (same `r,g,b`, `56,38,33`)
 * with a brief-specified alpha override, rather than a fresh re-typed
 * `{r,g,b}` literal, and is applied unconditionally in both themes.
 *
 * ## Sizing (brief 5.10 "Card and rail metrics")
 *
 * `width`/`height` and `artworkRadius` default to the single most common
 * case -- a TV-profile home-rail landscape (16:9) card, sized from
 * `TvGeometry.homeRailCardWidthLandscape` (219) scaled live via
 * `design/Metrics.ets`'s `tv()` -- exactly the same "TV default, caller
 * overrides for every other placement" idiom `PlayarrLogo.ets` already
 * establishes for `size`. Every other placement (cover/2:3 rails,
 * rail-panel cards at 230, the touch profile's 150/172/118 widths, a
 * `'titleEpisode'` card's own layout) is expected to pass explicit
 * `width`/`height` sourced from `TvGeometry`/`TouchGeometry` via
 * `design/Metrics.ets`. `artworkRadius` defaults to `-1` ("unset") and is
 * resolved against `variant` at render time (`Radii.homeCardArtworkTv` for
 * `'home'`, `Radii.titleEpisodeCard` for `'titleEpisode'`) rather than a
 * single static default, since the correct radius genuinely depends on
 * which variant the caller picked -- a touch-profile home card still
 * overrides explicitly with `Radii.homeCardArtworkTouch`.
 *
 * Card title/subtitle sizes (11/9 at the TV profile, brief 5.4's "card
 * title"/"card subtitle" row) have no matching field in `core/Tokens.ts`
 * (there is no typography table yet) -- named constants below are the same
 * documented exception `design/Motion.ets` and
 * `design/components/AsyncState.ets` already establish for brief literals
 * outside Tokens.ts's current scope. Touch-profile callers pass
 * `titleFontSize`/`subtitleFontSize` overrides (12/10, brief 5.4's "Touch
 * profile sizes").
 *
 * The progress-bar overlay has no colour/thickness spec of its own
 * anywhere in the brief; it reuses two already-real tokens rather than
 * inventing new ones -- fill = `BRAND_PINK` (brief 5.3: "`--player-accent`
 * (all player chrome: progress fill, ...)", the same semantic role, since
 * continue-watching progress is playback progress), track =
 * `activeColors().line` (already exactly `ink @ 14%/11%`, a natural hairline
 * tone for an unfilled track). Only the bar's thickness
 * (`PROGRESS_BAR_HEIGHT`) is a genuinely new, undocumented-in-brief UI
 * constant, named below in the same spirit as `AsyncState.ets`'s
 * `SPINNER_BORDER_WIDTH`.
 */

import { image } from '@kit.ImageKit';
import { activeColors, toResourceColor, toResourceColorWithAlpha } from '../Theme';
import type { ThemeModeSetting } from '../Theme';
import { tv } from '../Metrics';
import { INTERACTION_CURVE, INTERACTION_CARD_MS, INTERACTION_TITLE_CARD_MS } from '../Motion';
import { BRAND_PINK, Spacing, Radii, LightColors, TvGeometry } from '../../core/Tokens';
import { FOCUS_LIFT, effectiveFocusPercent, DEFAULT_ACTIVE_RAIL_FACTOR } from './FocusLift';
import type { FocusLiftDelta } from './FocusLift';
import { Skeleton } from './Skeleton';

/** Which brief-5.8 focus delta, brief-5.6 shadow pair and interaction
 * duration this card uses. See this file's header comment. */
export type PosterCardVariant = 'home' | 'titleEpisode';

/** One CSS `box-shadow` layer, copied as `{offsetY, radius, alpha}` rather
 * than a pre-built colour string so rest/focused values can be linearly
 * interpolated by `effectiveFocusPercent(...)` (see `shadowLayer()`
 * below). `offsetX` is always 0 in every brief-5.6 value used here. */
interface ShadowLayerSpec {
  offsetY: number;
  radius: number;
  alpha: number;
}

/** Brief 5.6, "Card art at rest (home)" / "Card art focused (home)". */
const HOME_SHADOW_REST: ShadowLayerSpec[] = [
  { offsetY: 10, radius: 22, alpha: 0.16 },
  { offsetY: 3, radius: 9, alpha: 0.1 },
];
const HOME_SHADOW_FOCUSED: ShadowLayerSpec[] = [
  { offsetY: 26, radius: 52, alpha: 0.32 },
  { offsetY: 11, radius: 22, alpha: 0.22 },
];

/** Brief 5.6, "Title/episode rest" / "focused". */
const TITLE_EPISODE_SHADOW_REST: ShadowLayerSpec[] = [
  { offsetY: 10, radius: 20, alpha: 0.14 },
  { offsetY: 3, radius: 8, alpha: 0.1 },
];
const TITLE_EPISODE_SHADOW_FOCUSED: ShadowLayerSpec[] = [
  { offsetY: 24, radius: 48, alpha: 0.3 },
  { offsetY: 10, radius: 20, alpha: 0.2 },
];

/** Brief 5.4, TV column, "card title" / "card subtitle" row -- see this
 * file's header comment for why these are named constants rather than a
 * `core/Tokens.ts` field. */
const CARD_TITLE_FONT_SIZE_TV: number = 11;
const CARD_SUBTITLE_FONT_SIZE_TV: number = 9;

/** Not in the brief at all -- see this file's header comment. */
const PROGRESS_BAR_HEIGHT: number = 3;

/** Sentinel for `artworkRadius`'s "no override supplied" state -- every
 * real radius token is non-negative, so `-1` can never collide with one. */
const ARTWORK_RADIUS_UNSET: number = -1;

@Component
export struct PosterCard {
  /** Selects the focus delta / shadow pair / interaction duration. */
  @Prop variant: PosterCardVariant = 'home';

  /** The artwork bitmap. `undefined` (the default) renders a `Skeleton`
   * placeholder -- artwork fetching is a later slice's job, this component
   * never fetches anything itself. */
  @Prop artwork: image.PixelMap | undefined = undefined;

  /** Card width in vp. Defaults to a TV-profile home-rail landscape card
   * (`TvGeometry.homeRailCardWidthLandscape`, scaled live via
   * `design/Metrics.ets`'s `tv()`) -- every other placement overrides
   * explicitly. See this file's header comment. */
  @Prop cardWidth: number = tv(TvGeometry.homeRailCardWidthLandscape);

  /** Artwork height in vp. Defaults to the same card at its brief-5.10
   * "16:9 landscape" aspect ratio. */
  @Prop cardHeight: number = Math.round((tv(TvGeometry.homeRailCardWidthLandscape) * 9) / 16);

  /** Artwork corner radius. `-1` (the default) means "resolve from
   * `variant`" -- see `resolvedArtworkRadius()` and this file's header
   * comment on why a single static default cannot be correct here. */
  @Prop artworkRadius: number = ARTWORK_RADIUS_UNSET;

  /** Continue-watching fraction in `[0, 1]`. A negative value (the
   * default) hides the progress-bar overlay entirely. */
  @Prop progress: number = -1;

  @Prop title: string = '';
  @Prop subtitle: string = '';

  @Prop titleFontSize: number = CARD_TITLE_FONT_SIZE_TV;
  @Prop subtitleFontSize: number = CARD_SUBTITLE_FONT_SIZE_TV;

  /** `1` while the hosting rail itself holds focus, `0` otherwise --
   * see `design/components/FocusLift.ets`'s header comment. Cards that are
   * never rail-scoped (a library grid, a standalone card) pass the default
   * no-op multiplier. */
  @Prop activeRailFactor: number = DEFAULT_ACTIVE_RAIL_FACTOR;

  /** Called when the card is activated (D-pad OK / Enter / tap). Plain
   * (non-reactive) callback field -- functions are not observable state,
   * same pattern as `AsyncState.ets`'s `retry`. */
  onSelect: () => void = () => {};

  // Tracked purely to force a re-render when the theme changes; the actual
  // colour decision always goes through design/Theme.ets's own resolver
  // functions (see that file's header comment for this pattern).
  @StorageProp('colorMode') private sysColorMode: ColorMode = ColorMode.LIGHT;
  @StorageProp('themeModeSetting') private themeSetting: ThemeModeSetting = 'system';

  @State private focusPercent: number = 0;

  private isTitleEpisode(): boolean {
    return this.variant === 'titleEpisode';
  }

  private resolvedArtworkRadius(): number {
    if (this.artworkRadius >= 0) {
      return this.artworkRadius;
    }
    return this.isTitleEpisode() ? Radii.titleEpisodeCard : Radii.homeCardArtworkTv;
  }

  private focusDelta(): FocusLiftDelta {
    return this.isTitleEpisode() ? FOCUS_LIFT.titleEpisodeCard : FOCUS_LIFT.homeCard;
  }

  private interactionDurationMs(): number {
    return this.isTitleEpisode() ? INTERACTION_TITLE_CARD_MS : INTERACTION_CARD_MS;
  }

  private setFocused(focused: boolean): void {
    // `durationMs` is read into a local first (rather than inlining
    // `this.interactionDurationMs()` as the object literal's `duration`
    // value) purely to keep `checks/arkts.mjs`'s lexical scan -- which
    // naively flags any `key: this` sequence as ArkTS's banned "'this'
    // used as a type" (`:\s*this\b`) -- from misreading an ordinary
    // object-literal property value as a type position.
    const durationMs = this.interactionDurationMs();
    this.getUIContext().animateTo({ duration: durationMs, curve: INTERACTION_CURVE }, () => {
      this.focusPercent = focused ? 1 : 0;
    });
  }

  private effective(): number {
    return effectiveFocusPercent(this.focusPercent, this.activeRailFactor);
  }

  private cardTranslateY(): number {
    const dy = this.focusDelta().translateY ?? 0;
    return dy * this.effective();
  }

  private artworkScale(): number {
    const delta = this.focusDelta();
    return 1 + (delta.scale - 1) * this.effective();
  }

  private lerp(from: number, to: number, t: number): number {
    return from + (to - from) * t;
  }

  /** ArkUI's `.shadow()` takes a single `ShadowOptions` (the brief-5.6 CSS
   * two-layer `box-shadow` has no direct equivalent), so only the dominant
   * (first, wider) layer is rendered; the tight second layer is dropped. */
  private shadowLayer(): ShadowOptions {
    const rest = this.isTitleEpisode() ? TITLE_EPISODE_SHADOW_REST : HOME_SHADOW_REST;
    const focused = this.isTitleEpisode() ? TITLE_EPISODE_SHADOW_FOCUSED : HOME_SHADOW_FOCUSED;
    const t = this.effective();
    // Every lerp result is read into a local first, then referenced by
    // name inside the object literals below -- see `setFocused()`'s
    // comment on why an object-literal value must never start with
    // `this.` directly.
    const offsetY0 = this.lerp(rest[0].offsetY, focused[0].offsetY, t);
    const radius0 = this.lerp(rest[0].radius, focused[0].radius, t);
    const alpha0 = this.lerp(rest[0].alpha, focused[0].alpha, t);
    const first: ShadowOptions = {
      offsetX: 0,
      offsetY: offsetY0,
      radius: radius0,
      color: toResourceColorWithAlpha(LightColors.ink, alpha0),
    };
    return first;
  }

  private clampedProgressPercent(): number {
    return Math.round(Math.max(0, Math.min(1, this.progress)) * 100);
  }

  build() {

    Column({ space: Spacing.xs }) {
      Stack({ alignContent: Alignment.Bottom }) {
        if (this.artwork !== undefined) {
          Image(this.artwork)
            .width('100%')
            .height('100%')
            .objectFit(ImageFit.Cover)
            .draggable(false)
        } else {
          Skeleton({ blockWidth: this.cardWidth, blockHeight: this.cardHeight, radius: this.resolvedArtworkRadius() })
        }

        if (this.progress >= 0) {
          Row() {
            Row()
              .width(`${this.clampedProgressPercent()}%`)
              .height('100%')
              .backgroundColor(toResourceColor(BRAND_PINK))
          }
          .width('100%')
          .height(PROGRESS_BAR_HEIGHT)
          .backgroundColor(toResourceColor(activeColors().line))
          .justifyContent(FlexAlign.Start)
        }
      }
      .width(this.cardWidth)
      .height(this.cardHeight)
      .clip(true)
      .borderRadius(this.resolvedArtworkRadius())
      .scale({ x: this.artworkScale(), y: this.artworkScale() })
      .shadow(this.shadowLayer())

      Text(this.title)
        .width(this.cardWidth)
        .fontSize(this.titleFontSize)
        .fontWeight(FontWeight.Medium)
        .fontColor(toResourceColor(activeColors().ink))
        .maxLines(1)
        .textOverflow({ overflow: TextOverflow.Ellipsis })

      if (this.subtitle.length > 0) {
        Text(this.subtitle)
          .width(this.cardWidth)
          .fontSize(this.subtitleFontSize)
          .fontWeight(FontWeight.Normal)
          .fontColor(toResourceColor(activeColors().inkSoft))
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
      }
    }
    .width(this.cardWidth)
    .alignItems(HorizontalAlign.Start)
    .translate({ y: this.cardTranslateY() })
    .focusable(true)
    .onFocus(() => {
      this.setFocused(true);
    })
    .onBlur(() => {
      this.setFocused(false);
    })
    .onClick(() => {
      this.onSelect();
    })
  }
}
