/**
 * One labelled choice section in a drawer (web `FilterSection` + `.tv-filter-choice-grid` / `.tv-segmented`):
 * a small uppercase heading over equal-width choice tiles, the chosen one filled with ink.
 */

import { activeColors, toResourceColor, toResourceColorWithAlpha } from '../Theme';
import type { ThemeModeSetting } from '../Theme';
import { tv } from '../Metrics';

export interface Choice {
  value: string;
  label: string;
}

const SECTION_WIDTH: number = 268;
const HEADING_SIZE: number = 9.6;
const HEADING_LETTER_SPACING: number = 0.672;
const HEADING_GAP: number = 13;
const CHOICE_HEIGHT: number = 56;
const CHOICE_GAP: number = 8;
const CHOICE_RADIUS: number = 12;
const CHOICE_LABEL_SIZE: number = 10.56;
const SECTION_GAP: number = 30;
const LARGE_HEADING_SIZE: number = 26.4;
const LARGE_HEADING_LETTER_SPACING: number = -0.924;
const LARGE_HEADING_GAP: number = 16;
// Web inactive choice: surface-soft at 0.64.
const INACTIVE_BG_ALPHA: number = 0.64;

@Component
export struct ChoiceSegments {
  @Prop heading: string = '';
  @Prop choices: Choice[] = [];
  @Prop selected: string = '';
  /** Settings panels (web `.appearance-setting`): a 26.4 px heading over choices across `width`. */
  @Prop large: boolean = false;
  @Prop sectionWidth: number = SECTION_WIDTH;
  onChoose: (value: string) => void = () => {};

  @StorageProp('colorMode') private sysColorMode: ColorMode = ColorMode.LIGHT;
  @StorageProp('themeModeSetting') private themeSetting: ThemeModeSetting = 'system';
  @StorageProp('tvScaleFactor') private trackedTvScale: number = 1;

  private choiceWidth(): number {
    const count = Math.max(1, this.choices.length);
    return (this.sectionWidth - CHOICE_GAP * (count - 1)) / count;
  }

  build() {
    Column({ space: tv(this.large ? LARGE_HEADING_GAP : HEADING_GAP) }) {
      if (this.large) {
        Text(this.heading)
          .fontSize(tv(LARGE_HEADING_SIZE))
          .fontWeight(FontWeight.Medium)
          .letterSpacing(tv(LARGE_HEADING_LETTER_SPACING))
          .fontColor(toResourceColor(activeColors().ink))
      } else {
        Text(this.heading)
          .fontSize(tv(HEADING_SIZE))
          .fontWeight(FontWeight.Bold)
          .letterSpacing(tv(HEADING_LETTER_SPACING))
          .textCase(TextCase.UpperCase)
          .fontColor(toResourceColor(activeColors().inkSoft))
      }
      Row({ space: tv(CHOICE_GAP) }) {
        ForEach(this.choices, (choice: Choice) => {
          Text(choice.label)
            .width(tv(this.choiceWidth()))
            .height(tv(CHOICE_HEIGHT))
            .textAlign(TextAlign.Center)
            .fontSize(tv(CHOICE_LABEL_SIZE))
            .fontWeight(FontWeight.Bold)
            .fontColor(toResourceColor(choice.value === this.selected ? activeColors().bg : activeColors().inkSoft))
            .backgroundColor(choice.value === this.selected ? toResourceColor(activeColors().ink) :
              toResourceColorWithAlpha(activeColors().surfaceSoft, INACTIVE_BG_ALPHA))
            .borderRadius(tv(CHOICE_RADIUS))
            .border({ width: 1, color: toResourceColorWithAlpha(activeColors().ink, 0.083) })
            .focusable(true)
            .onClick(() => {
              this.onChoose(choice.value);
            })
        }, (choice: Choice): string => choice.value)
      }
    }
    .alignItems(HorizontalAlign.Start)
    .margin({ bottom: tv(SECTION_GAP) })
  }
}
