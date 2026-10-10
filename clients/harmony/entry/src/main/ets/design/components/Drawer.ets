/**
 * The one right-side panel (web `.drawer` / `.tv-filter-drawer`): full height from the first frame, 360 wide
 * at the right edge, a kicker and title, a round close button and a body slot. Every side panel (Filters,
 * long-press actions, downloads) uses this. It overlays the page; the page is never rebuilt behind it.
 */

import { activeColors, toResourceColor, toResourceColorWithAlpha } from '../Theme';
import type { ThemeModeSetting } from '../Theme';
import { tv } from '../Metrics';

const DRAWER_WIDTH: number = 360;
const DRAWER_BG_ALPHA: number = 0.94;
const PADDING_H: number = 46;
const HEADER_TOP: number = 54;
// Web body starts at y=163: 34 below the 75 high header block.
const BODY_GAP: number = 34;
const KICKER_SIZE: number = 9.6;
const KICKER_LETTER_SPACING: number = 0.672;
const TITLE_SIZE: number = 38.4;
const TITLE_LETTER_SPACING: number = -2.112;
const CLOSE_SIZE: number = 48;
const CLOSE_GLYPH_SIZE: number = 26.88;
const SHADOW_COLOR: string = 'rgba(40, 26, 24, 0.24)';

@Component
export struct Drawer {
  @Prop kicker: string = '';
  @Prop title: string = '';
  onClose: () => void = () => {};

  @Builder
  private emptyBody(): void {}

  @BuilderParam body: () => void = this.emptyBody;

  @StorageProp('colorMode') private sysColorMode: ColorMode = ColorMode.LIGHT;
  @StorageProp('themeModeSetting') private themeSetting: ThemeModeSetting = 'system';
  @StorageProp('tvScaleFactor') private trackedTvScale: number = 1;

  build() {
    Column() {
      Row() {
        Column({ space: tv(4) }) {
          Text(this.kicker)
            .fontSize(tv(KICKER_SIZE))
            .fontWeight(FontWeight.Bold)
            .letterSpacing(tv(KICKER_LETTER_SPACING))
            .textCase(TextCase.UpperCase)
            .fontColor(toResourceColor(activeColors().inkSoft))
          Text(this.title)
            .fontSize(tv(TITLE_SIZE))
            .fontWeight(FontWeight.Medium)
            .letterSpacing(tv(TITLE_LETTER_SPACING))
            .fontColor(toResourceColor(activeColors().ink))
        }
        .alignItems(HorizontalAlign.Start)
        .layoutWeight(1)
        Text('×')
          .fontSize(tv(CLOSE_GLYPH_SIZE))
          .fontWeight(FontWeight.Bold)
          .fontColor(toResourceColor(activeColors().ink))
          .textAlign(TextAlign.Center)
          .width(tv(CLOSE_SIZE))
          .height(tv(CLOSE_SIZE))
          .borderRadius(tv(CLOSE_SIZE / 2))
          .backgroundColor(toResourceColor(activeColors().surfaceSoft))
          .border({ width: 1, color: toResourceColorWithAlpha(activeColors().ink, 0.15) })
          .focusable(true)
          .defaultFocus(true)
          .onClick(() => {
            this.onClose();
          })
      }
      .width('100%')
      .alignItems(VerticalAlign.Top)
      .margin({ top: tv(HEADER_TOP) })
      Scroll() {
        Column() {
          this.body()
        }
        .width('100%')
        .alignItems(HorizontalAlign.Start)
      }
      .width('100%')
      .layoutWeight(1)
      .align(Alignment.Top)
      .scrollBar(BarState.Off)
      .edgeEffect(EdgeEffect.None)
      .margin({ top: tv(BODY_GAP) })
    }
    .width(tv(DRAWER_WIDTH))
    .height('100%')
    .padding({ left: tv(PADDING_H), right: tv(PADDING_H) })
    .backgroundColor(toResourceColorWithAlpha(activeColors().surfaceStrong, DRAWER_BG_ALPHA))
    .shadow({ radius: tv(90), offsetX: -tv(32), offsetY: 0, color: SHADOW_COLOR })
    .position({ x: '100%', y: 0 })
    .markAnchor({ x: '100%', y: 0 })
  }
}
