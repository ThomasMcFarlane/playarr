/**
 * A labelled multi-choice select in a drawer (web `FilterSection` + `components/ui/MultiSelect.tsx`): chosen
 * values as ink tokens with "×" (tap to remove), then a trigger reading "Any …" / "Add …" with a chevron;
 * the trigger opens a list of options with check boxes. Sizes are web's at 1920x1080 (1rem = 19.2 px).
 */

import { activeColors, toResourceColor, toResourceColorWithAlpha } from '../Theme';
import type { ThemeModeSetting } from '../Theme';
import { tv } from '../Metrics';
import type { Choice } from './ChoiceSegments';

const SECTION_WIDTH: number = 268;
const HEADING_SIZE: number = 9.6;
const HEADING_LETTER_SPACING: number = 0.672;
const HEADING_GAP: number = 13;
const FIELD_PADDING: number = 7.68;
const FIELD_RADIUS: number = 12;
const CONTROL_HEIGHT: number = 44;
const CONTROL_RADIUS: number = 10;
const CONTROL_PADDING: number = 14.4;
const CONTROL_FONT: number = 11.84;
const LIST_GAP: number = 9.6;
const TRIGGER_BASIS: number = 153.6;
const OPTION_RADIUS: number = 8;
const OPTION_GAP: number = 13.44;
const OPTION_PADDING: number = 11.52;
const BOX_SIZE: number = 22;
const BOX_RADIUS: number = 5;
const CHECK_FONT: number = 15.36;
// Web `--line-strong` in dark: rgba(223, 220, 221, 0.23); field fill is surface-soft at 0.64.
const LINE_STRONG_ALPHA: number = 0.23;
const FIELD_BG_ALPHA: number = 0.64;

@Component
export struct MultiSelect {
  @Prop heading: string = '';
  @Prop options: Choice[] = [];
  @Prop selected: string[] = [];
  @Prop noneLabel: string = '';
  @Prop addLabel: string = '';
  onChange: (values: string[]) => void = () => {};

  @StorageProp('colorMode') private sysColorMode: ColorMode = ColorMode.LIGHT;
  @StorageProp('themeModeSetting') private themeSetting: ThemeModeSetting = 'system';
  @StorageProp('tvScaleFactor') private trackedTvScale: number = 1;

  @State private open: boolean = false;

  private isOn(value: string): boolean {
    return this.selected.indexOf(value) >= 0;
  }

  /** Toggles one value, keeping the options' own order (web). */
  private toggle(value: string): void {
    const next: string[] = [];
    for (const option of this.options) {
      const on = option.value === value ? !this.isOn(value) : this.isOn(option.value);
      if (on) {
        next.push(option.value);
      }
    }
    this.onChange(next);
  }

  private labelOf(value: string): string {
    const found = this.options.find((option: Choice) => option.value === value);
    return found !== undefined ? found.label : value;
  }

  private lineStrong(): ResourceColor {
    return toResourceColorWithAlpha(activeColors().ink, LINE_STRONG_ALPHA);
  }

  build() {
    Column({ space: tv(HEADING_GAP) }) {
      Text(this.heading)
        .fontSize(tv(HEADING_SIZE))
        .fontWeight(FontWeight.Bold)
        .letterSpacing(tv(HEADING_LETTER_SPACING))
        .textCase(TextCase.UpperCase)
        .fontColor(toResourceColor(activeColors().inkSoft))
      Column({ space: tv(LIST_GAP) }) {
        Flex({ wrap: FlexWrap.Wrap, alignItems: ItemAlign.Center }) {
          ForEach(this.selected, (value: string) => {
            Row({ space: tv(8.64) }) {
              Text(this.labelOf(value))
                .fontSize(tv(CONTROL_FONT))
                .fontWeight(FontWeight.Bold)
                .fontColor(toResourceColor(activeColors().bg))
              Text('×')
                .fontSize(tv(CONTROL_FONT))
                .fontWeight(FontWeight.Bold)
                .fontColor(toResourceColor(activeColors().bg))
            }
            .height(tv(CONTROL_HEIGHT))
            .constraintSize({ minWidth: tv(CONTROL_HEIGHT) })
            .padding({ left: tv(CONTROL_PADDING), right: tv(CONTROL_PADDING) })
            .borderRadius(tv(CONTROL_RADIUS))
            .backgroundColor(toResourceColor(activeColors().ink))
            .border({ width: 1, color: this.lineStrong() })
            .margin({ right: tv(FIELD_PADDING) })
            .focusable(true)
            .onClick(() => {
              this.toggle(value);
            })
          }, (value: string): string => value)
          Row() {
            Text(this.selected.length === 0 ? this.noneLabel : this.addLabel)
              .fontSize(tv(CONTROL_FONT))
              .fontWeight(FontWeight.Bold)
              .fontColor(toResourceColor(activeColors().ink))
              .layoutWeight(1)
            Text('⌄')
              .fontSize(tv(CONTROL_FONT))
              .fontColor(toResourceColor(activeColors().inkMuted))
              .rotate({ angle: this.open ? 180 : 0 })
          }
          // Web `flex: 1 1 8rem`: shares a line with the tokens when it fits.
          .flexGrow(1)
          .flexBasis(tv(TRIGGER_BASIS))
          .height(tv(CONTROL_HEIGHT))
          .padding({ left: tv(CONTROL_PADDING), right: tv(CONTROL_PADDING) })
          .borderRadius(tv(CONTROL_RADIUS))
          .focusable(true)
          .onClick(() => {
            this.open = !this.open;
          })
        }
        .width(tv(SECTION_WIDTH))
        .padding(tv(FIELD_PADDING))
        .borderRadius(tv(FIELD_RADIUS))
        .border({ width: 1, color: this.lineStrong() })
        .backgroundColor(toResourceColorWithAlpha(activeColors().surfaceSoft, FIELD_BG_ALPHA))

        if (this.open) {
          Column() {
            ForEach(this.options, (option: Choice) => {
              Row({ space: tv(OPTION_GAP) }) {
                Text(this.isOn(option.value) ? '✓' : '')
                  .fontSize(tv(CHECK_FONT))
                  .fontColor(toResourceColor(this.isOn(option.value) ? activeColors().bg : activeColors().ink))
                  .textAlign(TextAlign.Center)
                  .width(tv(BOX_SIZE))
                  .height(tv(BOX_SIZE))
                  .borderRadius(tv(BOX_RADIUS))
                  .border({ width: 2, color: toResourceColor(activeColors().ink) })
                  .backgroundColor(this.isOn(option.value) ? toResourceColor(activeColors().ink) : Color.Transparent)
                Text(option.label)
                  .fontSize(tv(CONTROL_FONT))
                  .fontColor(toResourceColor(activeColors().ink))
                  .layoutWeight(1)
              }
              .width('100%')
              .constraintSize({ minHeight: tv(CONTROL_HEIGHT) })
              .padding({ left: tv(OPTION_PADDING), right: tv(OPTION_PADDING) })
              .borderRadius(tv(OPTION_RADIUS))
              .focusable(true)
              .onClick(() => {
                this.toggle(option.value);
              })
            }, (option: Choice): string => `${option.value}:${this.isOn(option.value)}`)
          }
          .width(tv(SECTION_WIDTH))
          .padding(tv(FIELD_PADDING))
          .borderRadius(tv(FIELD_RADIUS))
          .border({ width: 1, color: this.lineStrong() })
          .backgroundColor(toResourceColor(activeColors().surfaceStrong))
        }
      }
      .alignItems(HorizontalAlign.Start)
    }
    .alignItems(HorizontalAlign.Start)
  }
}
