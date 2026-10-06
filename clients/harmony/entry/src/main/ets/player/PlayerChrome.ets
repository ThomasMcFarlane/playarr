/**
 * The Player screen's custom control bar (brief section 2's component
 * tree: "Custom control bar: title, progress, buffered, time, transport
 * buttons, 3.5s auto-hide") -- there is no native OSD anywhere in this
 * client (brief Slice 7 acceptance: "Custom control bar (no native OSD)").
 * This file renders chrome only; it owns no `@kit.MediaKit` state at all --
 * every value it shows is a `@Prop` the hosting `pages/Player.ets` (a
 * later slice) feeds in from its own `player/AvPlayerController.ets`, and
 * every button here only ever calls a plain callback prop, never touches
 * the player directly.
 *
 * ## Always dark, regardless of theme (brief 5.6)
 *
 * "Context drawers and the player are always dark regardless of theme:
 * `linear-gradient(180deg, rgba(34,25,31,0.98), rgba(12,9,12,0.99))`, `#fff`
 * text." Unlike every other component in this design system, this file
 * therefore NEVER reads `design/Theme.ets`'s `activeColors()`/
 * `resolvedThemeMode()` and has NO `@StorageProp('colorMode')`/
 * `('themeModeSetting')` re-render hook -- there is nothing theme-dependent
 * left to re-render for. Every colour below is a fixed literal.
 *
 * ## Where the brand pink is allowed here (brief 5.3 / 5.6)
 *
 * "`--player-accent` (all player chrome: progress fill, ...)" is one of the
 * few places `BRAND_PINK` (`core/Tokens.ts`) is correct -- everywhere else
 * in this app it is explicitly NOT the button colour (brief 5.3: "Using
 * the pink for CTAs is the single most obvious way to look wrong"). Here it
 * is used for exactly two things: the progress-bar fill, and the small
 * "LIVE" badge that replaces the progress bar for an unresolved/live
 * duration (see "Progress math" below) -- both a direct "player-accent"
 * role, nothing more. Every button and every icon in this bar is plain
 * white, not pink.
 *
 * ## Auto-hide (brief 5.10 `playerAutoHideMs`, 3500 ms both profiles)
 *
 * `design/Metrics.ets#activeGeometry()`'s own header comment explicitly
 * names `playerAutoHideMs` as one of the handful of fields shared,
 * identically-named, across `TvGeometryTokens`/`TouchGeometryTokens` --
 * this file is exactly the "generic component" that comment anticipates
 * reading it profile-agnostically through that union accessor, rather than
 * branching on `isTvMetrics()` the way every other (profile-divergent)
 * metric in this file does.
 *
 * The timer (`scheduleAutoHide()`/`autoHideTimerHandle`) only ever runs
 * while `isPlaying` is true AND no button in this bar holds focus
 * (`focusedCount === 0`) -- brief: "auto-hiding after 3500 ms while playing
 * with nothing focused". `ChromeButton` below reports its own focus
 * transitions up via `notifyFocusChanged`, which this component aggregates
 * into that one `focusedCount`.
 *
 * Two distinct triggers make the bar reappear immediately, both ending in
 * the same `reveal()`:
 * - a button in THIS bar gaining focus (`setChildFocused(true)`), and
 * - `keepAliveSignal` changing -- a plain counter the hosting page bumps on
 *   every key-down or touch ANYWHERE on the player screen, including over
 *   the video surface, which is a SIBLING of this component, not something
 *   inside its own subtree (this component's own `onKeyEvent`-free design,
 *   below, means it has no way to observe those key/touch events itself).
 *   `@Prop @Watch('onKeepAliveSignal')` is the ArkUI-idiomatic way to react
 *   to an externally-driven value change without an imperative method call
 *   on a child component instance.
 *
 * The show/hide cross-fade uses `design/Motion.ets#FADE_OPACITY_MS` (brief
 * 5.7: "Property fades: `ease` 180 ms (opacity/colour/background)") with
 * the ambient `Curve.Ease` that same brief line names -- not
 * `INTERACTION_CURVE`, which is reserved for the cubic-bezier interaction
 * curve brief 5.7 gives a different role (cards/buttons/rail headings).
 *
 * ## No `.onKeyEvent()` anywhere in this file
 *
 * `player/PlayerInput.ets`'s header comment states the rule this file
 * follows: a focused, clickable node must rely ONLY on `.onClick()` (plus
 * ArkUI's native Enter/OK-triggers-click synthesis) for D-pad activation,
 * never ALSO its own `.onKeyEvent()` for the same key -- that double-wires
 * the same action. Every control in this bar (`ChromeButton`) is
 * `.focusable(true)` + `.onClick()` and nothing else. D-pad key handling
 * for the Player screen (seek, back, media-transport keys) lives entirely
 * in `player/PlayerInput.ets`, consumed by whatever root-level listener
 * `pages/Player.ets` installs above both this bar and the video surface.
 *
 * ## Icons: real vector shapes, not asset references or exotic glyphs
 *
 * No icon asset pipeline exists yet in this project's
 * `resources/base/media/` (only `app_icon`, `start_icon` and
 * `playarr_logo` are real files there today) -- an `$r()` reference to a
 * play-icon media asset that does not exist would fail
 * `scripts/checks/resources.mjs` at build time, not just look wrong. So:
 * - The PAUSE icon is two plain filled `Column`s (`PlayPauseGlyph` below)
 *   -- the exact same "a coloured box is a component" primitive
 *   `design/components/Skeleton.ets` already relies on.
 * - The PLAY icon is a `Polygon` (`.points()` + `.fill()`), a real,
 *   long-standing ArkUI shape primitive -- but (per this project's whole
 *   offline-validation strategy: no ArkTS compiler, no device) this is the
 *   one piece of this file that cannot be verified without one, flagged
 *   here rather than silently assumed correct, the same "record it as an
 *   explicit divergence" posture `design/components/MediaRail.ets` and
 *   `design/components/NavRail.ets` already establish for their own
 *   unverified assumptions.
 * - Seek back/forward render as literal `'-10s'`/`'+10s'` text rather than
 *   an icon at all -- deliberately, both to avoid a THIRD unverified glyph
 *   shape and because the number is the actual seek amount
 *   `player/PlayerInput.ets#SEEK_STEP_MS` (10000 ms) applies, so the label
 *   is exact, not decorative.
 * - The mandatory top-row "Back" button (brief 5.10: "top buttons 48 tall
 *   labelled" TV / "44 tall icon-only" touch) reads the literal word
 *   `'Back'` on the TV profile and a plain `'<'` character on touch --
 *   satisfying "labelled" vs "icon-only" with zero glyph-availability risk
 *   (every font renders ASCII). This bar deliberately does NOT expose a
 *   generic extensible top-actions row (a later audio-track/subtitle-
 *   track/quality picker) -- out of scope here; adding one is a future
 *   caller-facing addition to this file, not a gap in it.
 *
 * ## Progress math (brief: "`duration === -1` (live) is guarded everywhere
 * progress maths runs")
 *
 * `durationMs <= 0` (an unresolved `duration_ms === 0` that
 * `core/PlaybackMath.ts#resolveDurationMs` has not yet reconciled, or a
 * genuinely live source) is treated as "live": the progress bar and
 * remaining-time text are replaced by a bare elapsed time plus a small
 * "LIVE" badge, rather than computing a `position/duration` fraction that
 * would divide by zero or render a meaningless bar. `positionMs`/
 * `durationMs`/`bufferedPositionMs` are all plain player-local values (NOT
 * `core/PlaybackMath.ts#reportedPositionMs`-adjusted) -- that adjustment is
 * exclusively for what gets reported to the server
 * (`player/PlaybackSessionReporter.ets`), never for what this bar displays.
 *
 * ## Metrics (brief 5.10's "player control bar" row)
 *
 * `paddingH`/`gap`/`titleFontSize`/`playIconSize`/`topButtonHeight` each
 * default from the active device profile via a small `defaultChrome*()`
 * helper (mirroring `design/components/MediaRail.ets`'s own
 * `defaultRailItemGap()`/`defaultRailHeadingSize()` pattern) but remain
 * overridable `@Prop`s. Two profile asymmetries are worth calling out:
 * - TV's field is `playerControlBarPaddingH` (explicitly horizontal-only);
 *   touch's is `playerControlBarPadding` (no `H` suffix) -- read here as a
 *   deliberate naming difference, not an oversight: TV gets horizontal-only
 *   padding (with a separate, reasoned vertical inset, `Spacing.md`);
 *   touch's single field is applied uniformly on all four sides.
 * - Touch has no `playerControlBarTitleSize`/`playerControlBarGap` field at
 *   all. `TOUCH_TITLE_FONT_SIZE_FALLBACK`/`TOUCH_CHROME_GAP_FALLBACK` below
 *   are reasoned defaults (the latter reuses `core/Tokens.ts`'s generic
 *   `Spacing.sm`), the same documented-exception pattern
 *   `design/components/PosterCard.ets`/`AsyncState.ets` already establish
 *   for brief literals with no home in `core/Tokens.ts`.
 */

import { isTvMetrics, tv, activeGeometry } from '../design/Metrics';
import { TvGeometry, TouchGeometry, BRAND_PINK, Spacing } from '../core/Tokens';
import type { RgbaColor } from '../core/Tokens';
import { toResourceColor, toResourceColorWithAlpha } from '../design/Theme';
import { INTERACTION_CURVE, INTERACTION_CARD_MS, FADE_OPACITY_MS } from '../design/Motion';
import { FOCUS_LIFT, effectiveFocusPercent, DEFAULT_ACTIVE_RAIL_FACTOR } from '../design/components/FocusLift';

// -- Fixed dark-mode-only palette (brief 5.6) -- see this file's header. --

const CHROME_GRADIENT_TOP: RgbaColor = { r: 34, g: 25, b: 31, a: 0.98 };
const CHROME_GRADIENT_BOTTOM: RgbaColor = { r: 12, g: 9, b: 12, a: 0.99 };
const CHROME_TEXT_PRIMARY: RgbaColor = { r: 255, g: 255, b: 255, a: 1 };
const CHROME_TEXT_SECONDARY: RgbaColor = { r: 255, g: 255, b: 255, a: 0.7 };
const CHROME_TRACK_ALPHA: number = 0.28;
const CHROME_BUFFERED_ALPHA: number = 0.46;

// Brief 5.4's "button" typographic role (16 / 720 -> `FontWeight.Bold` per
// that section's own weight-rounding guidance) -- reused for every text
// label in this bar (Back, seek back/forward) since none of them has a
// more specific role of its own in brief 5.4's table.
const BUTTON_LABEL_FONT_SIZE: number = 16;

// Brief 5.4's "title meta" role's SIZE (15) -- the closest documented
// "small info text near a title" role, reused for elapsed/remaining time
// and the LIVE badge rather than inventing an unrelated new size.
const TIME_LABEL_FONT_SIZE: number = 15;

// Not in the brief at all -- see this file's header comment ("Metrics").
const TOUCH_TITLE_FONT_SIZE_FALLBACK: number = 15;
const TOUCH_CHROME_GAP_FALLBACK: number = Spacing.sm;
const PROGRESS_TRACK_HEIGHT: number = 4;
const BACK_BUTTON_WIDTH_TV: number = 96;

function defaultChromePaddingH(): number {
  if (isTvMetrics()) {
    return tv(TvGeometry.playerControlBarPaddingH);
  }
  return TouchGeometry.playerControlBarPadding;
}

function defaultChromePaddingV(): number {
  if (isTvMetrics()) {
    return Spacing.md;
  }
  return TouchGeometry.playerControlBarPadding;
}

function defaultChromeGap(): number {
  if (isTvMetrics()) {
    return tv(TvGeometry.playerControlBarGap);
  }
  return TOUCH_CHROME_GAP_FALLBACK;
}

function defaultChromeTitleFontSize(): number {
  if (isTvMetrics()) {
    return tv(TvGeometry.playerControlBarTitleSize);
  }
  return TOUCH_TITLE_FONT_SIZE_FALLBACK;
}

function defaultChromePlayIconSize(): number {
  if (isTvMetrics()) {
    return tv(TvGeometry.playerControlBarPlayIconSize);
  }
  return TouchGeometry.playerControlBarPlayIconSize;
}

function defaultChromeTopButtonHeight(): number {
  if (isTvMetrics()) {
    return tv(TvGeometry.playerControlBarTopButtonSize);
  }
  return TouchGeometry.playerControlBarTopButtonSize;
}

/** The seek/play-pause transport buttons are square, sized from the play
 * icon plus one generic `Spacing` step of breathing room on each side --
 * not a brief literal, a reasoned tap-target size in the same spirit as
 * `design/components/PosterCard.ets`'s own `PROGRESS_BAR_HEIGHT`. */
function defaultChromeTransportBoxSize(): number {
  return defaultChromePlayIconSize() + Spacing.md;
}

/** Formats a millisecond duration as `m:ss`, or `h:mm:ss` once it reaches
 * an hour. Negative input clamps to zero. Presentation-only formatting
 * local to this component -- it makes no decision `core/PlaybackMath.ts`
 * documents (no clamping to duration, no completion threshold), it only
 * renders an already-decided millisecond value as text. */
function formatClockMs(ms: number): string {
  const totalSeconds = Math.floor(Math.max(0, ms) / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const paddedSeconds = String(seconds).padStart(2, '0');
  if (hours > 0) {
    const paddedMinutes = String(minutes).padStart(2, '0');
    return String(hours) + ':' + paddedMinutes + ':' + paddedSeconds;
  }
  return String(minutes) + ':' + paddedSeconds;
}

const PAUSE_BAR_WIDTH_RATIO: number = 0.24;
const PAUSE_BAR_HEIGHT_RATIO: number = 0.78;
const PAUSE_BAR_GAP_RATIO: number = 0.2;
const PLAY_TRIANGLE_INSET_X_RATIO: number = 0.22;
const PLAY_TRIANGLE_TIP_X_RATIO: number = 0.86;
const PLAY_TRIANGLE_TOP_Y_RATIO: number = 0.12;
const PLAY_TRIANGLE_BOTTOM_Y_RATIO: number = 0.88;
const PLAY_TRIANGLE_CENTER_Y_RATIO: number = 0.5;

/** The play/pause transport glyph -- see this file's header comment,
 * "Icons: real vector shapes...", for why this is drawn rather than
 * referencing an asset or a Unicode symbol. Purely presentational: no
 * focus/click handling of its own, that lives on `ChromeButton` below. */
@Component
struct PlayPauseGlyph {
  @Prop isPlaying: boolean = false;
  @Prop glyphSize: number = 24;

  build() {

    Stack({ alignContent: Alignment.Center }) {
      if (this.isPlaying) {
        Row({ space: (this.glyphSize * PAUSE_BAR_GAP_RATIO) }) {
          Column().width((this.glyphSize * PAUSE_BAR_WIDTH_RATIO)).height((this.glyphSize * PAUSE_BAR_HEIGHT_RATIO)).backgroundColor(toResourceColor(CHROME_TEXT_PRIMARY))
          Column().width((this.glyphSize * PAUSE_BAR_WIDTH_RATIO)).height((this.glyphSize * PAUSE_BAR_HEIGHT_RATIO)).backgroundColor(toResourceColor(CHROME_TEXT_PRIMARY))
        }
      } else {
        Polygon()
          .width(this.glyphSize)
          .height(this.glyphSize)
          .points([
            [this.glyphSize * PLAY_TRIANGLE_INSET_X_RATIO, this.glyphSize * PLAY_TRIANGLE_TOP_Y_RATIO],
            [this.glyphSize * PLAY_TRIANGLE_INSET_X_RATIO, this.glyphSize * PLAY_TRIANGLE_BOTTOM_Y_RATIO],
            [this.glyphSize * PLAY_TRIANGLE_TIP_X_RATIO, this.glyphSize * PLAY_TRIANGLE_CENTER_Y_RATIO],
          ])
          .fill(toResourceColor(CHROME_TEXT_PRIMARY))
      }
    }
    .width(this.glyphSize)
    .height(this.glyphSize)
  }
}

/**
 * One focusable, clickable control in this bar. Renders `label` as plain
 * text unless `showGlyph` is set, in which case it renders `PlayPauseGlyph`
 * instead (the play/pause button). Deliberately never attaches
 * `.onKeyEvent()` -- see this file's header comment.
 */
@Component
struct ChromeButton {
  label: string = '';
  buttonWidth: number = 44;
  buttonHeight: number = 44;
  fontSize: number = BUTTON_LABEL_FONT_SIZE;
  showGlyph: boolean = false;
  isPlaying: boolean = false;
  glyphSize: number = 24;

  /** Plain (non-reactive) callback fields -- functions are not observable
   * state, the same pattern as every other content component in this
   * design system (e.g. `design/components/PosterCard.ets#onSelect`). */
  onActivate: () => void = () => {};
  /** Reports this button's own focus transitions up to the hosting
   * `PlayerChrome`, which aggregates every button's focus state into the
   * one `focusedCount` the auto-hide timer keys off (this file's header
   * comment). */
  notifyFocusChanged: (focused: boolean) => void = () => {};

  @State private focusPercent: number = 0;

  private setFocused(focused: boolean): void {
    const notify = this.notifyFocusChanged;
    this.getUIContext().animateTo({ duration: INTERACTION_CARD_MS, curve: INTERACTION_CURVE }, () => {
      this.focusPercent = focused ? 1 : 0;
    });
    notify(focused);
  }

  build() {

    Stack({ alignContent: Alignment.Center }) {
      if (this.showGlyph) {
        PlayPauseGlyph({ isPlaying: this.isPlaying, glyphSize: this.glyphSize })
      } else {
        Text(this.label)
          .fontSize(this.fontSize)
          .fontWeight(FontWeight.Bold)
          .fontColor(toResourceColor(CHROME_TEXT_PRIMARY))
          .maxLines(1)
      }
    }
    .width(this.buttonWidth)
    .height(this.buttonHeight)
    .scale({ x: (1 + (FOCUS_LIFT.button.scale - 1) * effectiveFocusPercent(this.focusPercent, DEFAULT_ACTIVE_RAIL_FACTOR)), y: (1 + (FOCUS_LIFT.button.scale - 1) * effectiveFocusPercent(this.focusPercent, DEFAULT_ACTIVE_RAIL_FACTOR)) })
    .focusable(true)
    .onFocus(() => {
      this.setFocused(true);
    })
    .onBlur(() => {
      this.setFocused(false);
    })
    .onClick(() => {
      this.onActivate();
    })
  }
}

@Component
export struct PlayerChrome {
  @Prop title: string = '';
  @Prop positionMs: number = 0;
  @Prop durationMs: number = 0;
  @Prop bufferedPositionMs: number = 0;
  @Prop isPlaying: boolean = false;

  /** Bumped by the hosting page (`pages/Player.ets`, a later slice) on
   * every key-down or touch anywhere on the player screen -- see this
   * file's header comment, "Auto-hide", for why an external `@Watch`-driven
   * nudge, not a listener owned by this component, is how "reappears
   * immediately on any key press or touch" is satisfied for input this
   * component's own subtree never sees (the video surface is a sibling,
   * not a descendant, of this bar). */
  @Prop @Watch('onKeepAliveSignal') keepAliveSignal: number = 0;

  @Prop paddingH: number = defaultChromePaddingH();
  @Prop paddingV: number = defaultChromePaddingV();
  @Prop gap: number = defaultChromeGap();
  @Prop titleFontSize: number = defaultChromeTitleFontSize();
  @Prop playIconSize: number = defaultChromePlayIconSize();
  @Prop topButtonHeight: number = defaultChromeTopButtonHeight();

  /** Plain (non-reactive) callback fields -- see `ChromeButton#onActivate`'s
   * own comment for why these are not `@Prop`/`@State`. */
  onTogglePlayPause: () => void = () => {};
  onSeekBack: () => void = () => {};
  onSeekForward: () => void = () => {};
  onBack: () => void = () => {};

  @State private chromeOpacity: number = 1;
  @State private visible: boolean = true;
  @State private focusedCount: number = 0;
  private autoHideTimerHandle: number | null = null;

  aboutToAppear(): void {
    this.scheduleAutoHide();
  }

  aboutToDisappear(): void {
    this.clearAutoHideTimer();
  }

  /** `@Watch` target for `keepAliveSignal` -- see this file's header
   * comment, "Auto-hide". */
  private onKeepAliveSignal(): void {
    this.reveal();
  }

  private reveal(): void {
    this.visible = true;
    this.getUIContext().animateTo({ duration: FADE_OPACITY_MS, curve: Curve.Ease }, () => {
      this.chromeOpacity = 1;
    });
    this.scheduleAutoHide();
  }

  private hide(): void {
    this.visible = false;
    this.getUIContext().animateTo({ duration: FADE_OPACITY_MS, curve: Curve.Ease }, () => {
      this.chromeOpacity = 0;
    });
  }

  private autoHideMs(): number {
    return activeGeometry().playerAutoHideMs;
  }

  private clearAutoHideTimer(): void {
    if (this.autoHideTimerHandle !== null) {
      clearTimeout(this.autoHideTimerHandle);
      this.autoHideTimerHandle = null;
    }
  }

  /** (Re)starts the 3500 ms countdown, or leaves none running at all while
   * `isPlaying` is false or a button in this bar holds focus -- brief:
   * "auto-hiding after 3500 ms while playing with nothing focused". */
  private scheduleAutoHide(): void {
    this.clearAutoHideTimer();
    if (!this.isPlaying || this.focusedCount > 0) {
      return;
    }
    this.autoHideTimerHandle = setTimeout((): void => {
      this.autoHideTimerHandle = null;
      this.hide();
    }, this.autoHideMs());
  }

  /** `ChromeButton#notifyFocusChanged`'s target -- aggregates every
   * button's own focus state into one "is anything in this bar focused"
   * count. Gaining focus always reveals immediately; losing it just
   * restarts the countdown (from zero elapsed, a deliberate simplification
   * -- the brief specifies no partial-countdown-preservation behaviour). */
  private setChildFocused(focused: boolean): void {
    if (focused) {
      this.focusedCount += 1;
      this.reveal();
      return;
    }
    this.focusedCount = Math.max(0, this.focusedCount - 1);
    this.scheduleAutoHide();
  }

  /** See this file's header comment, "Progress math". */
  private isLive(): boolean {
    return this.durationMs <= 0;
  }

  private progressPercent(): number {
    if (this.isLive()) {
      return 0;
    }
    const fraction = this.positionMs / this.durationMs;
    return Math.round(Math.max(0, Math.min(1, fraction)) * 100);
  }

  private bufferedPercent(): number {
    if (this.isLive()) {
      return 0;
    }
    const fraction = this.bufferedPositionMs / this.durationMs;
    return Math.round(Math.max(0, Math.min(1, fraction)) * 100);
  }

  private remainingMs(): number {
    return Math.max(0, this.durationMs - this.positionMs);
  }

  build() {

    Column({ space: this.gap }) {
      Row() {
        ChromeButton({
          label: (isTvMetrics() ? 'Back' : '<'),
          buttonWidth: (isTvMetrics() ? BACK_BUTTON_WIDTH_TV : this.topButtonHeight),
          buttonHeight: this.topButtonHeight,
          onActivate: this.onBack,
          notifyFocusChanged: ((focused: boolean): void => {
      this.setChildFocused(focused);
    }),
        })
      }
      .width('100%')
      .justifyContent(FlexAlign.Start)

      Text(this.title)
        .width('100%')
        .fontSize(this.titleFontSize)
        .fontWeight(FontWeight.Medium)
        .fontColor(toResourceColor(CHROME_TEXT_PRIMARY))
        .maxLines(1)
        .textOverflow({ overflow: TextOverflow.Ellipsis })

      Column({ space: Spacing.xs }) {
        if (!this.isLive()) {
          Stack({ alignContent: Alignment.Start }) {
            Row()
              .width('100%')
              .height(PROGRESS_TRACK_HEIGHT)
              .backgroundColor(toResourceColorWithAlpha(CHROME_TEXT_PRIMARY, CHROME_TRACK_ALPHA))

            Row()
              .width(`${this.bufferedPercent()}%`)
              .height(PROGRESS_TRACK_HEIGHT)
              .backgroundColor(toResourceColorWithAlpha(CHROME_TEXT_PRIMARY, CHROME_BUFFERED_ALPHA))

            Row()
              .width(`${this.progressPercent()}%`)
              .height(PROGRESS_TRACK_HEIGHT)
              .backgroundColor(toResourceColor(BRAND_PINK))
          }
          .width('100%')

          Row() {
            Text(formatClockMs(this.positionMs)).fontSize(TIME_LABEL_FONT_SIZE).fontColor(toResourceColor(CHROME_TEXT_SECONDARY))
            Text(('-' + formatClockMs(this.remainingMs()))).fontSize(TIME_LABEL_FONT_SIZE).fontColor(toResourceColor(CHROME_TEXT_SECONDARY))
          }
          .width('100%')
          .justifyContent(FlexAlign.SpaceBetween)
        } else {
          Row() {
            Text(formatClockMs(this.positionMs)).fontSize(TIME_LABEL_FONT_SIZE).fontColor(toResourceColor(CHROME_TEXT_SECONDARY))
            Text('LIVE').fontSize(TIME_LABEL_FONT_SIZE).fontWeight(FontWeight.Bold).fontColor(toResourceColor(BRAND_PINK))
          }
          .width('100%')
          .justifyContent(FlexAlign.SpaceBetween)
        }
      }
      .width('100%')

      Row({ space: this.gap }) {
        ChromeButton({
          label: '-10s',
          buttonWidth: defaultChromeTransportBoxSize(),
          buttonHeight: defaultChromeTransportBoxSize(),
          onActivate: this.onSeekBack,
          notifyFocusChanged: ((focused: boolean): void => {
      this.setChildFocused(focused);
    }),
        })

        ChromeButton({
          showGlyph: true,
          isPlaying: this.isPlaying,
          glyphSize: this.playIconSize,
          buttonWidth: defaultChromeTransportBoxSize(),
          buttonHeight: defaultChromeTransportBoxSize(),
          onActivate: this.onTogglePlayPause,
          notifyFocusChanged: ((focused: boolean): void => {
      this.setChildFocused(focused);
    }),
        })

        ChromeButton({
          label: '+10s',
          buttonWidth: defaultChromeTransportBoxSize(),
          buttonHeight: defaultChromeTransportBoxSize(),
          onActivate: this.onSeekForward,
          notifyFocusChanged: ((focused: boolean): void => {
      this.setChildFocused(focused);
    }),
        })
      }
      .width('100%')
      .justifyContent(FlexAlign.Center)
    }
    .width('100%')
    .padding({ left: this.paddingH, right: this.paddingH, top: this.paddingV, bottom: this.paddingV })
    .linearGradient({
      angle: 180,
      colors: [
        [toResourceColor(CHROME_GRADIENT_TOP), 0],
        [toResourceColor(CHROME_GRADIENT_BOTTOM), 1],
      ],
    })
    .opacity(this.chromeOpacity)
    .hitTestBehavior(this.visible ? HitTestMode.Default : HitTestMode.Transparent)
  }
}
