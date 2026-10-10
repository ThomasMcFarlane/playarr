/**
 * The TV shell clock (web `.app-clock`): "04:06  SUN 11 OCTOBER", time and date on one baseline row.
 * Sizes, weights and tracking copy the live web TV layout at 1920x1080; English names only, like the
 * rest of this client today.
 */

import { activeColors, toResourceColor } from '../Theme';
import type { ThemeModeSetting } from '../Theme';
import { tv } from '../Metrics';
import { clockDate, clockTime } from '../../core/ClockFormat';

// ArkUI takes weights in steps of 100; web uses 760 (time) and 640 (date).
const TIME_FONT_SIZE: number = 17.28;
const TIME_FONT_WEIGHT: number = 800;
const TIME_LETTER_SPACING: number = -0.518;
const DATE_FONT_SIZE: number = 11.136;
const DATE_FONT_WEIGHT: number = 600;
const DATE_LETTER_SPACING: number = 0.445;
const TIME_DATE_GAP: number = 11;
const MINUTE_MS: number = 60000;

@Component
export struct Clock {
  @StorageProp('colorMode') private sysColorMode: ColorMode = ColorMode.LIGHT;
  @StorageProp('themeModeSetting') private themeSetting: ThemeModeSetting = 'system';
  @StorageProp('tvScaleFactor') private trackedTvScale: number = 1;

  @State private now: Date = new Date();
  private timer: number = -1;
  private startTimer: number = -1;

  aboutToAppear(): void {
    // Tick on the minute boundary, then every minute.
    this.startTimer = setTimeout((): void => {
      this.now = new Date();
      this.timer = setInterval((): void => {
        this.now = new Date();
      }, MINUTE_MS);
    }, MINUTE_MS - (Date.now() % MINUTE_MS));
  }

  aboutToDisappear(): void {
    clearTimeout(this.startTimer);
    clearInterval(this.timer);
  }

  build() {
    Row({ space: tv(TIME_DATE_GAP) }) {
      Text(clockTime(this.now))
        .fontSize(tv(TIME_FONT_SIZE))
        .fontWeight(TIME_FONT_WEIGHT)
        .letterSpacing(tv(TIME_LETTER_SPACING))
        .fontColor(toResourceColor(activeColors().ink))
      Text(clockDate(this.now))
        .fontSize(tv(DATE_FONT_SIZE))
        .fontWeight(DATE_FONT_WEIGHT)
        .letterSpacing(tv(DATE_LETTER_SPACING))
        .textCase(TextCase.UpperCase)
        .fontColor(toResourceColor(activeColors().ink))
    }
    .alignItems(VerticalAlign.Bottom)
    .focusable(false)
  }
}
