/**
 * The touch-profile bottom floating navigation pill (brief 5.10's touch nav
 * column): a `BottomCenter`-anchored glass pill of icon-only tiles,
 * expected to be placed as a sibling of whatever full-bleed screen content
 * it floats over (the same self-positioning idiom
 * `design/components/Stage.ets`/`NavRail.ets` already establish for their
 * own device profile).
 *
 * ## Structure and geometry (brief 5.10, touch column)
 *
 * Two nested layers, both named explicitly in the same brief table cell:
 * an OUTER glass pill (padding h10/v8 -- `navPaddingH`/`navPaddingV`,
 * radius 20 -- `navRadius`) around an INNER content row (its own padding 5
 * -- `navRowPadding`, item gap 2 -- `navRowGap`) that actually lays out the
 * icon tiles. Each tile is 46 tall (`navItemHeight`), radius 16
 * (`navItemRadius`), horizontal padding 12 (`navItemPaddingH`), holding one
 * 21dp icon-only glyph (`navIconOnlySize`) -- no label, matching this
 * file's own "icon-only items" brief.
 *
 * ## The glass recipe (brief 5.6) -- and its `core/Tokens.ts` tension
 *
 * Brief 5.6 names this exact element: "nav pill: `surfaceStrong 64%`,
 * `blur(26px) saturate(125%)`, 1px border `line 65%`, `0 20px 55px
 * rgba(56,38,33,0.12)`". `core/Tokens.ts`'s `TouchGeometryTokens` instead
 * carries `navBackgroundOpacity: 0.94` and `navShadow: 18` for this same
 * component -- read here as the OTHER documented brief-5.6/R7 path: "if
 * [backdrop blur is] unusable, degrade to a flat higher-opacity fill and
 * log it". `0.94` is that flat, no-blur fallback opacity (a plain
 * `surfaceStrong` fill needs to be much more opaque than `64%` to stay
 * legible with no blur behind it); `18` is very plausibly the same
 * shorthand-single-number treatment `NavRail.ets`'s own `navGroupShadow`
 * gets, this time roughly matching brief 5.6's full `{offsetY:20,
 * radius:55, alpha:0.12}` triple. This file implements the true glass path
 * (`surfaceStrong@64%` + blur + brief 5.6's full shadow triple) as its
 * primary rendering and leaves `navBackgroundOpacity`/`navShadow` as the
 * documented fallback numbers a future on-device R7 check should switch to
 * if blur proves unusable -- not wired as a runtime branch here, since
 * there is no compile-time (or, on this Linux workstation, any) way to
 * detect blur availability; brief 7.4 defers exactly this class of
 * question to physical-device testing.
 *
 * `.backdropBlur()`'s `saturate(125%)` component is NOT reproduced --
 * `design/components/Stage.ets`'s own header comment already researched
 * and settled this for the same platform: "`backdrop-filter: blur(...)
 * saturate(...)`'s `saturate()` component has no ArkUI backdrop equivalent
 * (`.saturate()` only affects a component's own content, not what is
 * sampled behind it via `.backdropBlur()`); only the blur is reproduced."
 * This file follows that same already-committed finding rather than
 * re-deriving it, per brief risk R7's "record it as an explicit
 * divergence, not a silent one".
 *
 * ## Selection / focus
 *
 * One tile is "selected" (the current route) at a time via a single
 * `selectedId` prop, exactly `NavRail.ets`'s own model. Brief 5.8's focus
 * table has no dedicated row for a touch-profile icon-only nav item (only
 * "TV nav tile" and the desktop-parity "nav link" are listed), so this
 * file reuses `FOCUS_LIFT.button` for the press/focus scale -- the same
 * "no dedicated delta exists, reuse the generic control token" choice
 * `design/components/AsyncState.ets`'s own retry button already makes for
 * an analogous generic pressable control. Selected/unselected is expressed
 * through icon colour only (`accent` vs `inkMuted`), since no scale/lift
 * value for that state is given anywhere in the brief either.
 */

import { activeColors, toResourceColor, toResourceColorWithAlpha } from '../Theme';
import type { ThemeModeSetting } from '../Theme';
import { INTERACTION_CURVE, INTERACTION_CARD_MS } from '../Motion';
import { TouchGeometry, LightColors } from '../../core/Tokens';
import { FOCUS_LIFT, effectiveFocusPercent, DEFAULT_ACTIVE_RAIL_FACTOR } from './FocusLift';

/** Brief 5.6's "nav pill" glass recipe. Distinct from
 * `TouchGeometry.navBackgroundOpacity` (0.94) -- see this file's header
 * comment on the two numbers' separate roles. */
const NAV_PILL_GLASS_OPACITY: number = 0.64;
const NAV_PILL_BLUR_RADIUS: number = 26;
const NAV_PILL_BORDER_ALPHA: number = 0.65;
const NAV_PILL_SHADOW_OFFSET_Y: number = 20;
const NAV_PILL_SHADOW_RADIUS: number = 55;
const NAV_PILL_SHADOW_ALPHA: number = 0.12;

/** One `NavPill` entry. `icon` accepts any `$r('app.media.*')` resource --
 * `.fillColor()` tints it per selection state (assumes a monochrome/SVG
 * icon asset; a harmless no-op on a raster icon that ignores it). */
export interface NavPillItem {
  id: string;
  icon: ResourceStr;
}

const NAV_PILL_PLACEHOLDER_ITEM: NavPillItem = { id: '', icon: $r('app.media.playarr_logo') };

@Component
struct NavPillTile {
  item: NavPillItem = NAV_PILL_PLACEHOLDER_ITEM;
  @Prop selected: boolean = false;

  /** Called when this tile is activated (tap / D-pad OK / Enter). Plain
   * (non-reactive) callback field -- functions are not observable state. */
  onSelect: (id: string) => void = () => {};

  // Tracked purely to force a re-render when the theme changes; the actual
  // colour decision always goes through design/Theme.ets's own resolver
  // functions (see that file's header comment for this pattern).
  @StorageProp('colorMode') private sysColorMode: ColorMode = ColorMode.Light;
  @StorageProp('themeModeSetting') private themeSetting: ThemeModeSetting = 'system';

  @State private focusPercent: number = 0;

  private setFocused(focused: boolean): void {
    this.getUIContext().animateTo({ duration: INTERACTION_CARD_MS, curve: INTERACTION_CURVE }, () => {
      this.focusPercent = focused ? 1 : 0;
    });
  }

  private iconColor(): string {
    if (this.selected) {
      return toResourceColor(activeColors().accent);
    }
    return toResourceColor(activeColors().inkMuted);
  }

  build() {
    const effective = effectiveFocusPercent(this.focusPercent, DEFAULT_ACTIVE_RAIL_FACTOR);
    const scale = 1 + (FOCUS_LIFT.button.scale - 1) * effective;
    const iconRes = this.item.icon;
    const tint = this.iconColor();

    Row() {
      Image(iconRes)
        .width(TouchGeometry.navIconOnlySize)
        .height(TouchGeometry.navIconOnlySize)
        .objectFit(ImageFit.Contain)
        .fillColor(tint)
        .draggable(false)
        .focusable(false)
    }
    .height(TouchGeometry.navItemHeight)
    .padding({ left: TouchGeometry.navItemPaddingH, right: TouchGeometry.navItemPaddingH })
    .borderRadius(TouchGeometry.navItemRadius)
    .clip(true)
    .justifyContent(FlexAlign.Center)
    .alignItems(VerticalAlign.Center)
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
export struct NavPill {
  items: NavPillItem[] = [];

  /** The current route's item id; drives which tile's icon renders in
   * `accent` rather than `inkMuted`. Empty (the default) selects nothing. */
  @Prop selectedId: string = '';

  /** Called with the activated item's `id`. Plain (non-reactive) callback
   * field -- functions are not observable state. */
  onSelect: (id: string) => void = () => {};

  // Tracked purely to force a re-render when the theme changes; the actual
  // colour decision always goes through design/Theme.ets's own resolver
  // functions (see that file's header comment for this pattern).
  @StorageProp('colorMode') private sysColorMode: ColorMode = ColorMode.Light;
  @StorageProp('themeModeSetting') private themeSetting: ThemeModeSetting = 'system';

  build() {
    const selected = this.selectedId;
    const dispatch = this.onSelect;

    // Two nested layers on purpose (see this file's header comment): the
    // OUTER glass pill (this Row) carries brief 5.10's `navPaddingH`/`V`
    // plus the whole brief-5.6 glass recipe, and wraps an INNER content Row
    // with its own, separate `navRowPadding`/`navRowGap` -- chaining a
    // second `.padding()` call onto the SAME component would simply
    // overwrite the first rather than nest it, so this needs two real
    // container levels, not two attribute calls on one.
    Row() {
      Row({ space: TouchGeometry.navRowGap }) {
        ForEach(
          this.items,
          (item: NavPillItem) => {
            NavPillTile({ item: item, selected: item.id === selected, onSelect: dispatch })
          },
          (item: NavPillItem): string => item.id
        )
      }
      .padding(TouchGeometry.navRowPadding)
    }
    .padding({
      left: TouchGeometry.navPaddingH,
      right: TouchGeometry.navPaddingH,
      top: TouchGeometry.navPaddingV,
      bottom: TouchGeometry.navPaddingV,
    })
    .borderRadius(TouchGeometry.navRadius)
    .clip(true)
    .backgroundColor(toResourceColorWithAlpha(activeColors().surfaceStrong, NAV_PILL_GLASS_OPACITY))
    .backdropBlur(NAV_PILL_BLUR_RADIUS)
    .border({ width: 1, color: toResourceColorWithAlpha(activeColors().line, NAV_PILL_BORDER_ALPHA) })
    .shadow({
      offsetX: 0,
      offsetY: NAV_PILL_SHADOW_OFFSET_Y,
      radius: NAV_PILL_SHADOW_RADIUS,
      color: toResourceColorWithAlpha(LightColors.ink, NAV_PILL_SHADOW_ALPHA),
    })
    .align(Alignment.BottomCenter)
  }
}
