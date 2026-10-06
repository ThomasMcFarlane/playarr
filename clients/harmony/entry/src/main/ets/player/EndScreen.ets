/**
 * The end-of-playback overlay (docs/architecture/end-of-playback.md):
 * either the ended card (Replay, Back to details, optionally Play next) or
 * the up-next countdown (Play now, Cancel, Replay, Back to details). The
 * hosting `pages/Player.ets` owns the state machine
 * (`core/EndOfPlayback.ts`) and passes in plain values and callbacks; this
 * file only renders. The suggestions row is supplied as the trailing
 * `@BuilderParam` slot so the page can build it from `MediaRail` +
 * `PosterCard` exactly as `pages/Detail.ets` does.
 *
 * Focus (spec section 6): the primary action is the default focus, the
 * action row is focusable left/right, Down reaches the suggestions slot.
 * Touch (section 7): every button is at least 48 vp tall, the card scrolls
 * vertically on phones, and tapping the dimmed backdrop does nothing.
 * Always dark, like the rest of the player (brief 5.6).
 */

import { Spacing, Radii, BRAND_PINK } from '../core/Tokens';
import type { RgbaColor } from '../core/Tokens';
import { toResourceColor, toResourceColorWithAlpha } from '../design/Theme';
import { isTvMetrics, tv } from '../design/Metrics';

const CARD_BACKDROP: RgbaColor = { r: 8, g: 6, b: 8, a: 0.88 };
const CARD_TEXT_PRIMARY: RgbaColor = { r: 255, g: 255, b: 255, a: 1 };

const HEADING_SIZE_TV: number = 34;
const HEADING_SIZE_TOUCH: number = 22;
const DETAIL_SIZE_TV: number = 22;
const DETAIL_SIZE_TOUCH: number = 15;
const BUTTON_SIZE_TV: number = 20;
const BUTTON_SIZE_TOUCH: number = 16;
const BUTTON_HEIGHT_TV: number = 52;
/** Spec section 7: tap targets are at least 48 vp. */
const BUTTON_HEIGHT_TOUCH: number = 48;
const FOCUSED_SCALE: number = 1.06;

@Component
struct EndButton {
  label: string = '';
  primary: boolean = false;
  /** Only one button on the card sets this: the primary action. */
  takeDefaultFocus: boolean = false;
  onActivate: () => void = () => {};

  @State private focused: boolean = false;

  build() {

    Text(this.label)
      .fontSize(isTvMetrics() ? tv(BUTTON_SIZE_TV) : BUTTON_SIZE_TOUCH)
      .fontWeight(FontWeight.Bold)
      .fontColor(toResourceColor(CARD_TEXT_PRIMARY))
      .maxLines(1)
      .height(isTvMetrics() ? tv(BUTTON_HEIGHT_TV) : BUTTON_HEIGHT_TOUCH)
      .padding({ left: Spacing.lg, right: Spacing.lg })
      .margin({ right: Spacing.md, bottom: Spacing.md })
      .textAlign(TextAlign.Center)
      .borderRadius(Radii.pillFull)
      .backgroundColor(toResourceColorWithAlpha((this.primary ? BRAND_PINK : CARD_TEXT_PRIMARY), (this.primary ? 1 : (this.focused ? 0.32 : 0.16))))
      .scale({ x: (this.focused ? FOCUSED_SCALE : 1), y: (this.focused ? FOCUSED_SCALE : 1) })
      .focusable(true)
      .defaultFocus(this.takeDefaultFocus)
      .accessibilityText(this.label)
      .onFocus(() => {
        this.focused = true;
      })
      .onBlur(() => {
        this.focused = false;
      })
      .onClick(() => {
        this.onActivate();
      })
  }
}

@Component
export struct EndScreen {
  /** `'endCard'` or `'upNext'`. */
  @Prop phase: string = 'endCard';
  /** Title of the item that just finished. */
  @Prop finishedTitle: string = '';
  /** Title of the next item; empty when nothing follows. */
  @Prop nextTitle: string = '';
  @Prop secondsRemaining: number = 0;
  /** False when autoplay is off: the card shows no countdown text. */
  @Prop countdownRunning: boolean = true;
  @Prop hasSuggestions: boolean = false;

  onPlayNow: () => void = () => {};
  onCancel: () => void = () => {};
  onReplay: () => void = () => {};
  onExit: () => void = () => {};

  @BuilderParam suggestionsSlot: () => void = this.noSuggestions;

  @Builder
  private noSuggestions(): void {}

  private heading(): string {
    if (this.phase === 'upNext') {
      if (this.countdownRunning) {
        return 'Playing in ' + String(this.secondsRemaining);
      }
      return 'Up next';
    }
    return this.finishedTitle.length > 0 ? 'Finished: ' + this.finishedTitle : 'Finished';
  }

  build() {

    Scroll() {
      Column({ space: Spacing.lg }) {
        Text(this.heading())
          .fontSize(isTvMetrics() ? tv(HEADING_SIZE_TV) : HEADING_SIZE_TOUCH)
          .fontWeight(FontWeight.Bold)
          .fontColor(toResourceColor(CARD_TEXT_PRIMARY))
          .maxLines(2)

        if ((this.nextTitle.length > 0)) {
          Text(this.nextTitle)
            .fontSize(isTvMetrics() ? tv(DETAIL_SIZE_TV) : DETAIL_SIZE_TOUCH)
            .fontColor(toResourceColorWithAlpha(CARD_TEXT_PRIMARY, 0.85))
            .maxLines(2)
        }

        Flex({ wrap: FlexWrap.Wrap }) {
          if ((this.nextTitle.length > 0)) {
            EndButton({
              label: (this.phase === 'upNext') ? 'Play now' : 'Play next',
              primary: true,
              takeDefaultFocus: true,
              onActivate: this.onPlayNow,
            })
          }
          if ((this.phase === 'upNext') && this.countdownRunning) {
            EndButton({ label: 'Cancel', onActivate: this.onCancel })
          }
          EndButton({
            label: 'Replay',
            primary: !(this.nextTitle.length > 0),
            takeDefaultFocus: !(this.nextTitle.length > 0),
            onActivate: this.onReplay,
          })
          EndButton({ label: 'Back to details', onActivate: this.onExit })
        }

        if (this.hasSuggestions) {
          Text('More like this')
            .fontSize(isTvMetrics() ? tv(DETAIL_SIZE_TV) : DETAIL_SIZE_TOUCH)
            .fontWeight(FontWeight.Bold)
            .fontColor(toResourceColor(CARD_TEXT_PRIMARY))
            .margin({ top: Spacing.md })
          this.suggestionsSlot()
        }
      }
      .alignItems(HorizontalAlign.Start)
      .width('100%')
      .padding({
        left: isTvMetrics() ? Spacing.xxxl : Spacing.md,
        right: isTvMetrics() ? Spacing.xxxl : Spacing.md,
        top: isTvMetrics() ? Spacing.xxl : Spacing.lg,
        bottom: Spacing.lg,
      })
    }
    .width('100%')
    .height('100%')
    .scrollBar(BarState.Off)
    .backgroundColor(toResourceColor(CARD_BACKDROP))
    .accessibilityText(((this.phase === 'upNext') ? 'Up next: ' + this.nextTitle : 'Finished playing ' + this.finishedTitle))
    // Swallow taps so the dimmed backdrop never dismisses or toggles anything.
    .onClick(() => {})
  }
}
