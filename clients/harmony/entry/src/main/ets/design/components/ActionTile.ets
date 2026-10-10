/**
 * A shell action-column tile (web `.tv-filter-launcher`, the 30 September look): icon over a small label,
 * stacked in the right-hand action column from (1846, 151), 72 apart plus 13. Pages add tiles here; they never
 * draw their own header buttons for panels.
 */

import { activeColors, toResourceColor, toResourceColorWithAlpha, tintFilter } from '../Theme';
import type { ThemeModeSetting } from '../Theme';
import { tv } from '../Metrics';

const TILE_LEFT: number = 1846;
const TILE_TOP: number = 151;
const TILE_WIDTH: number = 62;
const TILE_HEIGHT: number = 72;
const TILE_PITCH: number = 85;
const TILE_RADIUS: number = 14;
const TILE_BG_ALPHA: number = 0.78;
const ICON_SIZE: number = 24;
const LABEL_SIZE: number = 8.256;
const LABEL_LETTER_SPACING: number = 0.165;
const SHADOW_COLOR: string = 'rgba(56, 38, 33, 0.08)';

@Component
export struct ActionTile {
  icon: ResourceStr = $r('app.media.action_filters');
  @Prop label: string = '';
  /** Position in the action column, 0 at the top. */
  @Prop slot: number = 0;
  onActivate: () => void = () => {};

  @StorageProp('colorMode') private sysColorMode: ColorMode = ColorMode.LIGHT;
  @StorageProp('themeModeSetting') private themeSetting: ThemeModeSetting = 'system';
  @StorageProp('tvScaleFactor') private trackedTvScale: number = 1;

  build() {
    Column({ space: tv(6) }) {
      Image(this.icon)
        .width(tv(ICON_SIZE))
        .height(tv(ICON_SIZE))
        .colorFilter(tintFilter(activeColors().inkSoft))
        .focusable(false)
      Text(this.label)
        .fontSize(tv(LABEL_SIZE))
        .fontWeight(FontWeight.Bold)
        .letterSpacing(tv(LABEL_LETTER_SPACING))
        .fontColor(toResourceColor(activeColors().inkSoft))
        .maxLines(1)
    }
    .width(tv(TILE_WIDTH))
    .height(tv(TILE_HEIGHT))
    .justifyContent(FlexAlign.Center)
    .borderRadius(tv(TILE_RADIUS))
    .backgroundColor(toResourceColorWithAlpha(activeColors().surfaceStrong, TILE_BG_ALPHA))
    .border({ width: 1, color: toResourceColorWithAlpha(activeColors().ink, 0.075) })
    .shadow({ radius: tv(36), offsetX: 0, offsetY: tv(14), color: SHADOW_COLOR })
    .position({ x: tv(TILE_LEFT), y: tv(TILE_TOP + TILE_PITCH * this.slot) })
    .focusable(true)
    .onClick(() => {
      this.onActivate();
    })
  }
}
