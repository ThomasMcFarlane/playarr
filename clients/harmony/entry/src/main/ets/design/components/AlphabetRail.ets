/**
 * The TV library A-Z rail (web `.tv-alphabet`): a natively scrollable column of 44 px round letter
 * buttons on the right edge; the current letter is filled with ink. Geometry from the live web TV DOM.
 */

import { activeColors, toResourceColor } from '../Theme';
import type { ThemeModeSetting } from '../Theme';
import { tv } from '../Metrics';

const RAIL_LEFT: number = 1852;
const RAIL_TOP: number = 270;
const RAIL_WIDTH: number = 56;
const RAIL_HEIGHT: number = 810;
const RAIL_PADDING_TOP: number = 8;
const BUTTON_SIZE: number = 44;
const LETTER_SIZE: number = 9.216;

@Component
export struct AlphabetRail {
  @Prop letters: string[] = [];
  @Prop activeLetter: string = '';
  /** Called with the chosen letter. Plain callback field (functions are not observable state). */
  onJump: (letter: string) => void = () => {};

  @StorageProp('colorMode') private sysColorMode: ColorMode = ColorMode.LIGHT;
  @StorageProp('themeModeSetting') private themeSetting: ThemeModeSetting = 'system';
  @StorageProp('tvScaleFactor') private trackedTvScale: number = 1;

  build() {
    Scroll() {
      Column() {
        ForEach(this.letters, (letter: string) => {
          Text(letter)
            .width(tv(BUTTON_SIZE))
            .height(tv(BUTTON_SIZE))
            .textAlign(TextAlign.Center)
            .fontSize(tv(LETTER_SIZE))
            .fontColor(toResourceColor(letter === this.activeLetter ? activeColors().bg : activeColors().inkSoft))
            .backgroundColor(letter === this.activeLetter ? toResourceColor(activeColors().ink) : Color.Transparent)
            .borderRadius(tv(BUTTON_SIZE / 2))
            .focusable(true)
            .onClick(() => {
              this.onJump(letter);
            })
        }, (letter: string): string => letter)
      }
      .padding({ top: tv(RAIL_PADDING_TOP) })
      .width('100%')
    }
    .width(tv(RAIL_WIDTH))
    .height(tv(RAIL_HEIGHT))
    .align(Alignment.Top)
    .scrollBar(BarState.Off)
    .edgeEffect(EdgeEffect.None)
    .position({ x: tv(RAIL_LEFT), y: tv(RAIL_TOP) })
  }
}
