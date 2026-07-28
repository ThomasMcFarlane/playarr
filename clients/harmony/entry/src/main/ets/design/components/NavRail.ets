/**
 * The TV left-side navigation rail (brief 5.10's TV nav column): a
 * vertical glass group of 64x64 pill tiles, `CenterStart`-anchored at
 * `start 42` against whatever full-bleed 1920x1080 stage hosts it --
 * exactly the same self-positioning idiom `design/components/Stage.ets`
 * already establishes (this component expects to be placed as a sibling of
 * `Stage` inside one shared, fully-sized `Stack`, not nested inside `Stage`
 * itself; `Stage.ets`'s own header comment explicitly keeps its
 * `homeRailsColumn*`/`railPanel*` geometry separate from this rail for the
 * same reason).
 *
 * ## Geometry (brief 5.10, TV column)
 *
 * Group: radius 22 (`navGroupRadius`), `surfaceStrong@72%`
 * (`navGroupBackgroundOpacity`), border 1 `inkMuted@18%`
 * (`navGroupBorderWidth`/`navGroupBorderOpacity`), shadow 16
 * (`navGroupShadow`), padding h6/v7 (`navGroupPaddingH`/`navGroupPaddingV`),
 * item gap 5 (`navGroupItemGap`). Brief 5.6's three explicitly-named glass
 * recipes are "rail panel", "primary play action" and "nav pill" -- the TV
 * nav GROUP is not one of them, and neither brief 5.6 nor 5.10 gives it a
 * `backdropBlur`, so this component applies only the flat
 * `surfaceStrong@72%` fill (no blur) rather than inventing one.
 *
 * Tile: 64x64 (`navTileSize`), radius 16 (`navTileRadius`), icon 20
 * (`navTileIconSize`), label 7 (`navTileLabelSize`) -- brief 5.8's "TV nav
 * tile" row: `scale(1.10)` focused / `1.05` selected, background
 * `ink@0.14` focused / `ink@0.09` selected (`FOCUS_LIFT.tvNavTileFocused`
 * / `.tvNavTileSelected`; the two background alphas have no
 * `core/Tokens.ts` field, named constants below, the same
 * documented-exception pattern `AsyncState.ets`/`Skeleton.ets`/`Stage.ets`
 * already use).
 *
 * `navGroupShadow` (16) is a bare number in both brief 5.9's table and
 * `core/Tokens.ts` -- brief 5.6's shadows are always given as a full
 * `{offsetY, radius, alpha}` triple, but this one is not, so this file
 * treats `16` as the blur radius and derives a proportional `offsetY`
 * (half the radius) at `shadowSoft`'s own ambient alpha (brief 5.1: `0 22px
 * 65px rgba(56,38,33,0.09)`, the closest documented "general resting card"
 * shadow tone in the whole brief) -- a reasoned approximation, not an
 * invented one, and named/commented as such rather than silently baked in.
 *
 * ## Focus / selection model
 *
 * One tile is "selected" (the current route) at a time, driven by a single
 * `selectedId` prop rather than a per-item `selected` flag the caller would
 * otherwise have to compute -- `NavTile` compares `item.id === selectedId`
 * itself. `focusPercent` (focused, transient, animated) always wins over
 * `selected` (the current route, snapped rather than animated -- routes
 * change far less often than D-pad focus moves, so a hard cut here is an
 * acceptable simplification, not a corner cut on the brief's own
 * requirements, which name no cross-fade for this transition at all).
 *
 * ## Reachability (brief 6.3)
 *
 * "Secondary affordances are entered by Up, never Left/Right, because a
 * focused horizontal list consumes Left/Right." Tiles are stacked
 * VERTICALLY here, so Left/Right is never consumed by this component at
 * all -- there is nothing here for it to fight with a focused rail over,
 * satisfying that rule with no extra handling needed. Wiring the actual
 * "Up from the topmost rail reaches this component" jump is the composing
 * screen's job (see `design/components/MediaRail.ets`'s header comment on
 * why `nextFocus` cannot be applied from inside a rail to opaque item
 * content) -- each tile exposes a stable `.id('${item.id}-nav-tile')`
 * specifically so a caller CAN wire `.nextFocus({ up: '<id>-nav-tile' })`
 * on the topmost rail's own item content to target it explicitly.
 */

import { activeColors, toResourceColor, toResourceColorWithAlpha } from '../Theme';
import type { ThemeModeSetting } from '../Theme';
import { tv } from '../Metrics';
import { INTERACTION_CURVE, INTERACTION_CARD_MS } from '../Motion';
import { TvGeometry } from '../../core/Tokens';
import { FOCUS_LIFT } from './FocusLift';

/** Brief 5.8, "TV nav tile" row: `bg ink@0.14 / ink@0.09`. Not a
 * `core/Tokens.ts` field -- see this file's header comment. */
const NAV_TILE_FOCUSED_BG_ALPHA: number = 0.14;
const NAV_TILE_SELECTED_BG_ALPHA: number = 0.09;

/** `navGroupShadow` (16) reasoned approximation -- see this file's header
 * comment. */
const NAV_GROUP_SHADOW_OFFSET_RATIO: number = 0.5;
const NAV_GROUP_SHADOW_ALPHA: number = 0.09;

/** Vertical gap between a tile's icon and its label. Not in the brief at
 * all (5.10 gives the tile's own outer size/radius/icon/label sizes, but
 * no internal icon-to-label gap) -- a small named UI constant in the same
 * spirit as `PosterCard.ets`'s own `PROGRESS_BAR_HEIGHT`. */
const NAV_TILE_ICON_LABEL_GAP: number = 2;

/** One `NavRail` entry. `icon` accepts any `$r('app.media.*')` resource --
 * `NavTile` applies `.fillColor()` to it (assumes a monochrome/SVG-style
 * icon asset; a harmless no-op on a raster icon that ignores it). */
export interface NavRailItem {
  id: string;
  icon: ResourceStr;
  label: string;
}

const NAV_TILE_PLACEHOLDER_ITEM: NavRailItem = { id: '', icon: $r('app.media.playarr_logo'), label: '' };

@Component
struct NavTile {
  item: NavRailItem = NAV_TILE_PLACEHOLDER_ITEM;
  @Prop selected: boolean = false;

  /** Called when this tile is activated (D-pad OK / Enter / tap). Plain
   * (non-reactive) callback field -- functions are not observable state,
   * same pattern as `PosterCard.ets`'s `onSelect`. */
  onSelect: (id: string) => void = () => {};

  // Tracked purely to force a re-render on theme / TV-scale change; the
  // actual values always go through design/Theme.ets's resolvers and
  // design/Metrics.ets's tv() below (see those files' own header comments
  // for this exact pattern).
  @StorageProp('colorMode') private sysColorMode: ColorMode = ColorMode.Light;
  @StorageProp('themeModeSetting') private themeSetting: ThemeModeSetting = 'system';
  @StorageProp('tvScaleFactor') private trackedTvScale: number = 1;

  @State private focusPercent: number = 0;

  private setFocused(focused: boolean): void {
    this.getUIContext().animateTo({ duration: INTERACTION_CARD_MS, curve: INTERACTION_CURVE }, () => {
      this.focusPercent = focused ? 1 : 0;
    });
  }

  private targetScale(): number {
    if (this.focusPercent > 0) {
      return 1 + (FOCUS_LIFT.tvNavTileFocused.scale - 1) * this.focusPercent;
    }
    if (this.selected) {
      return FOCUS_LIFT.tvNavTileSelected.scale;
    }
    return 1;
  }

  private targetBackgroundAlpha(): number {
    if (this.focusPercent > 0) {
      return NAV_TILE_FOCUSED_BG_ALPHA * this.focusPercent;
    }
    if (this.selected) {
      return NAV_TILE_SELECTED_BG_ALPHA;
    }
    return 0;
  }

  build() {
    const scale = this.targetScale();
    const bgAlpha = this.targetBackgroundAlpha();
    const iconRes = this.item.icon;
    const labelText = this.item.label;
    const tileId = `${this.item.id}-nav-tile`;

    Column({ space: NAV_TILE_ICON_LABEL_GAP }) {
      Image(iconRes)
        .width(tv(TvGeometry.navTileIconSize))
        .height(tv(TvGeometry.navTileIconSize))
        .objectFit(ImageFit.Contain)
        .fillColor(toResourceColor(activeColors().ink))
        .draggable(false)
        .focusable(false)

      Text(labelText)
        .fontSize(tv(TvGeometry.navTileLabelSize))
        .fontColor(toResourceColor(activeColors().ink))
        .textAlign(TextAlign.Center)
        .maxLines(1)
        .textOverflow({ overflow: TextOverflow.Ellipsis })
    }
    .id(tileId)
    .width(tv(TvGeometry.navTileSize))
    .height(tv(TvGeometry.navTileSize))
    .justifyContent(FlexAlign.Center)
    .alignItems(HorizontalAlign.Center)
    .borderRadius(tv(TvGeometry.navTileRadius))
    .clip(true)
    .backgroundColor(toResourceColorWithAlpha(activeColors().ink, bgAlpha))
    .scale({ x: scale, y: scale })
    .focusable(true)
    .onFocus(() => {
      this.setFocused(true);
    })
    .onBlur(() => {
      this.setFocused(false);
    })
    .onClick(() => {
      this.onSelect(this.item.id);
    })
  }
}

@Component
export struct NavRail {
  items: NavRailItem[] = [];

  /** The current route's item id; drives which tile renders
   * `FOCUS_LIFT.tvNavTileSelected` at rest. Empty (the default) selects
   * nothing. */
  @Prop selectedId: string = '';

  /** Called with the activated item's `id`. Plain (non-reactive) callback
   * field -- functions are not observable state. */
  onSelect: (id: string) => void = () => {};

  // Tracked purely to force a re-render on theme / TV-scale change -- see
  // `NavTile`'s own identical fields for this exact pattern.
  @StorageProp('colorMode') private sysColorMode: ColorMode = ColorMode.Light;
  @StorageProp('themeModeSetting') private themeSetting: ThemeModeSetting = 'system';
  @StorageProp('tvScaleFactor') private trackedTvScale: number = 1;

  build() {
    const selected = this.selectedId;
    const dispatch = this.onSelect;

    Column({ space: tv(TvGeometry.navGroupItemGap) }) {
      ForEach(
        this.items,
        (item: NavRailItem) => {
          NavTile({ item: item, selected: item.id === selected, onSelect: dispatch })
        },
        (item: NavRailItem): string => item.id
      )
    }
    .padding({
      left: tv(TvGeometry.navGroupPaddingH),
      right: tv(TvGeometry.navGroupPaddingH),
      top: tv(TvGeometry.navGroupPaddingV),
      bottom: tv(TvGeometry.navGroupPaddingV),
    })
    .borderRadius(tv(TvGeometry.navGroupRadius))
    .clip(true)
    .backgroundColor(toResourceColorWithAlpha(activeColors().surfaceStrong, TvGeometry.navGroupBackgroundOpacity))
    .border({
      width: tv(TvGeometry.navGroupBorderWidth),
      color: toResourceColorWithAlpha(activeColors().inkMuted, TvGeometry.navGroupBorderOpacity),
    })
    .shadow({
      radius: tv(TvGeometry.navGroupShadow),
      offsetX: 0,
      offsetY: tv(TvGeometry.navGroupShadow) * NAV_GROUP_SHADOW_OFFSET_RATIO,
      color: toResourceColorWithAlpha(activeColors().ink, NAV_GROUP_SHADOW_ALPHA),
    })
    .position({ x: tv(TvGeometry.navStart), y: '50%' })
    .markAnchor({ x: 0, y: '50%' })
  }
}
