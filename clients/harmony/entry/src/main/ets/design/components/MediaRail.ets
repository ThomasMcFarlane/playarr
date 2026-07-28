/**
 * A titled horizontal rail of caller-rendered content (brief section 2's
 * component tree: "Horizontal media rail: title + scrollable row of
 * cards"), and the fix for the real regression brief section 5.8 documents
 * from the Roku port: every rail rendered its "selected" card as lifted at
 * once, because focus was tracked per-card instead of being scoped to
 * whichever rail actually held D-pad focus.
 *
 * ## Rail-scoped focus -- the whole point of this file
 *
 * `design/components/FocusLift.ets`'s own header comment prescribes the
 * fix: every rail-hosted component must multiply its local focus percent by
 * an `activeRailFactor` the RAIL computes and passes down -- `1` while the
 * rail itself holds focus, `0` (or a caller-chosen fallback, see
 * `unfocusedRailFactor` below) otherwise. This file is the rail half of
 * that contract; `design/components/PosterCard.ets` (already shipped) is
 * the consuming half -- its own header comment says outright "the caller (a
 * rail component, a later slice) is responsible for passing its own live
 * focus state down", i.e. this file.
 *
 * ## How "does any child hold focus" is actually detected
 *
 * `PosterCard` (the expected `itemBuilder` content) already owns its own
 * `.focusable(true)` / `.onFocus()` / `.onBlur()` / `.onClick()` -- it does
 * NOT expose a focus-change callback to its parent, and it must not be
 * wrapped in a second focusable container here (a `.focusable(true)`
 * wrapper around an already-focusable `PosterCard` creates exactly the kind
 * of duplicate-focus-stop ambiguity brief 6.3 warns about for
 * `onClick`+`onKeyEvent`, just one level up the tree, and ArkUI's
 * `onFocus`/`onBlur` do not bubble to ancestors the way DOM focus events
 * with `:focus-within` do). So this component cannot learn "a child
 * focused" by wrapping children in its own focus handlers.
 *
 * Instead, the scrolling `List` is marked a focus GROUP via
 * `.focusScopeId(railId, true, true)` (API 11+): `isGroup: true` asks the
 * framework to track group-level focus state (this is also what lets a
 * rail remember and restore its last-focused card when re-entered, and
 * `arrowStepOut: true` is what lets Up/Down actually leave the rail at its
 * top/bottom edge instead of being trapped, matching brief 6.3's "no wrap,
 * no edge escape" model for the rail's OWN edges while still permitting
 * escape to a neighbour). The `List`'s own `.onFocus()`/`.onBlur()` are
 * read here as firing on group-level focus entry/exit rather than only for
 * the `List` element itself becoming the literal focus target. **This is a
 * documented assumption, not a device-verified fact** (there is no ArkTS
 * compiler or device available while building this slice, per this
 * project's whole offline-validation strategy) -- if on-device testing
 * (brief 7.4) shows `onFocus`/`onBlur` do NOT fire for group-level
 * transitions, the fallback is threading an explicit
 * `notifyFocusChange: (focused: boolean) => void` callback through
 * `itemBuilder`'s signature for whatever focusable leaf the caller renders
 * to call directly -- flagged here rather than silently assumed correct,
 * the same "record it as an explicit divergence, not a silent one" posture
 * brief risk R7 asks for elsewhere.
 *
 * ## `nextFocus` vs. the platform default (brief 6.3)
 *
 * This file deliberately does NOT call `.nextFocus()` anywhere. The reason
 * is structural, not a preference: the actual focusable leaf per item is
 * caller-supplied opaque content invoked via `itemBuilder` (typically a
 * `PosterCard`) -- ArkUI's declarative attribute-chaining only applies to a
 * component instantiated directly in the same `build()`/`@Builder` call, so
 * `MediaRail` has no attribute-chain access to attach `.nextFocus()` onto
 * whatever `itemBuilder` renders. Concretely: reaching a secondary
 * affordance like `NavRail.ets` via Up (brief 6.3: "secondary affordances
 * are entered by Up, never Left/Right") from the TOPMOST rail on a screen
 * is the COMPOSING SCREEN's job, not this file's -- that screen's own item
 * content (or a thin per-screen wrapper around `PosterCard`) should set
 * `.nextFocus({ up: <NavRail's first-tile id> })` directly. This file relies
 * on the platform default cross-pattern search for every other direction
 * (Left/Right within the rail, which `List`'s own non-looping default
 * already keeps from wrapping; Down/Up between stacked rails, which the
 * default engine handles well for same-shaped vertically-stacked lists).
 *
 * ## Why `ForEach`, not `LazyForEach`
 *
 * A rail's item count comes from one paginated catalogue response (brief
 * 4.8) -- tens of items, not thousands -- so `LazyForEach`'s virtualisation
 * buys little here while adding real constraints (its item builder must be
 * a single static `@Builder`, which would have made threading a
 * caller-supplied `itemBuilder` `@BuilderParam` through it substantially
 * more awkward). Plain `ForEach` keyed by `item.id` is simpler and correct
 * for this data shape.
 *
 * ## Why `MediaRailItem`, not a generic `<T>` or `ESObject`
 *
 * `MediaRail` only needs a stable string id (for `ForEach`'s key
 * generator) from each item -- it never reads any other field itself, that
 * is entirely `itemBuilder`'s business. A one-field interface lets any real
 * catalogue item (`core/Types/Work.ts`'s `Work`, `WorkDetail`, etc. -- every
 * one of them already carries `id: string`) satisfy it structurally with no
 * cast, adapter, or generic-component machinery whose ArkUI-compiler
 * support cannot be verified offline.
 *
 * ## The negative-margin clip-inset recipe (brief 5.10)
 *
 * "Rails use negative margins (`margin: 0 0 -24px -8px` with matching
 * padding) purely so the focus lift and shadow are not clipped." The `List`
 * below reproduces this exactly: positive padding on the bottom/left gives
 * a focused card's `translateY`/`scale`/shadow room to render without being
 * clipped by the scrolling container's own bounds, and the matching
 * negative margin cancels that padding back out of the layout footprint
 * the rest of the column sees, so siblings above/below are not pushed by
 * the extra room. Not a `core/Tokens.ts` field (no clip-inset table exists
 * there) -- named constants below, the same documented-exception pattern
 * `design/components/AsyncState.ets`/`Skeleton.ets`/`Stage.ets` already
 * establish for brief literals outside `core/Tokens.ts`'s current scope.
 */

import { activeColors, toResourceColor } from '../Theme';
import type { ThemeModeSetting } from '../Theme';
import { isTvMetrics, tv, TvGeometry, TouchGeometry } from '../Metrics';
import { INTERACTION_CURVE, INTERACTION_CARD_MS } from '../Motion';
import { Spacing } from '../../core/Tokens';
import { FOCUS_LIFT, effectiveFocusPercent } from './FocusLift';

/** Brief 5.10's rail clip-inset recipe -- see this file's header comment. */
const RAIL_CLIP_INSET_BOTTOM: number = 24;
const RAIL_CLIP_INSET_START: number = 8;

/** Brief 5.4, "rail heading" row: `-0.03em` tracking. Not a
 * `core/Tokens.ts` field (that table has no typography tracking values) --
 * applied as `headingSize * RAIL_HEADING_TRACKING_EM` since ArkUI's
 * `.letterSpacing()` takes a length, not an `em` unit directly. */
const RAIL_HEADING_TRACKING_EM: number = -0.03;

/** `design/components/FocusLift.ets`'s own documented contract for
 * `activeRailFactor` is exactly "1 while the rail itself holds focus, 0
 * otherwise" -- this is that "0", named so `unfocusedRailFactor`'s default
 * reads as intentional rather than an arbitrary literal. A caller may
 * still override it to a small positive value for a persistent "this was
 * your last position in this rail" hint; the shipped brief does not
 * specify one, so the default keeps this file's behaviour identical to
 * `FocusLift.ets`'s plain contract. */
const DEFAULT_UNFOCUSED_RAIL_FACTOR: number = 0;

/** The minimal shape `MediaRail` needs from a rail item -- see this file's
 * header comment on why this is a one-field interface rather than a
 * generic `<T>` or `ESObject`. */
export interface MediaRailItem {
  id: string;
}

/** Brief 5.10: home-rail item gap is `railItemGapHome` (25) on TV /
 * `railItemGap` (12) on touch; a title rail instead wants
 * `TvGeometry.railItemGapTitle` (23) on TV, which a caller can pass
 * explicitly as `itemGap` to override this default. */
function defaultRailItemGap(): number {
  if (isTvMetrics()) {
    return tv(TvGeometry.railItemGapHome);
  }
  return TouchGeometry.railItemGap;
}

/** Brief 5.10's "rail heading" row: 18 (TV) / 16 (touch). Both tables carry
 * a same-named `railHeadingSize` field (see `design/Metrics.ets`'s own
 * comment on this deliberate cross-profile overlap), so this only needs to
 * decide whether to run it through `tv()`. */
function defaultRailHeadingSize(): number {
  if (isTvMetrics()) {
    return tv(TvGeometry.railHeadingSize);
  }
  return TouchGeometry.railHeadingSize;
}

@Component
export struct MediaRail {
  /** Must be unique across every `MediaRail` instance on the same screen --
   * it becomes this rail's `.focusScopeId()` (see this file's header
   * comment) and, if left at the default on more than one instance, rails
   * would share focus-group state with each other. */
  @Prop railId: string = 'media-rail';

  @Prop heading: string = '';

  /** Gap between adjacent cards, in vp. Defaults per brief 5.10's "home
   * rail" row for the active device profile -- see `defaultRailItemGap()`.
   * Pass `TvGeometry.railItemGapTitle` explicitly for a title/episode
   * rail on the TV profile. */
  @Prop itemGap: number = defaultRailItemGap();

  /** Rail-heading font size, in vp. Defaults per brief 5.10's "rail
   * heading" row for the active device profile. */
  @Prop headingSize: number = defaultRailHeadingSize();

  /** Rail-heading font weight. Brief 5.4 gives only one numeric weight
   * (610) for "rail heading", with no separate touch-profile value -- reused
   * for both profiles since no distinct touch number exists. `.fontWeight()`
   * accepts this raw numeric literal directly (ArkUI is not limited to the
   * `FontWeight` enum's 100-step scale), which is more faithful to
   * `core/Tokens.ts`'s own `railHeadingWeight: number` field than rounding
   * it to `FontWeight.Medium` the way brief 5.4's general guidance
   * describes doing when only the enum is available. */
  @Prop headingWeight: number = TvGeometry.railHeadingWeight;

  /** The rail-wide lift factor applied while this rail holds NO focus at
   * all -- see `DEFAULT_UNFOCUSED_RAIL_FACTOR`'s comment. */
  @Prop unfocusedRailFactor: number = DEFAULT_UNFOCUSED_RAIL_FACTOR;

  /** The rail's items. Plain (non-`@Prop`) rather than copy-observed --
   * `MediaRailItem` is a real interface (not an opaque/erased type), so a
   * `@Prop` array-of-interface would work, but a rail's items are supplied
   * once per catalogue page and re-set wholesale on reload, which a parent
   * re-constructing this component (as e.g. `Stage.ets`'s own `railsSlot`
   * caller would, once it exists) already handles without needing
   * per-field observation here. */
  items: MediaRailItem[] = [];

  /** Renders one item. Receives the rail-scoped `activeRailFactor` (this
   * file's whole point) as its third argument -- feed it straight into the
   * rendered content's own `activeRailFactor` prop (`PosterCard`'s, for
   * instance), which already multiplies it through `effectiveFocusPercent`
   * internally. The rendered content owns its OWN focusability / `onClick`
   * (see this file's header comment) -- `itemBuilder` must not wrap its
   * content in a second `.focusable(true)` layer. */
  @Builder
  private defaultItemBuilder(item: MediaRailItem, index: number, activeRailFactor: number): void {}

  @BuilderParam itemBuilder: (item: MediaRailItem, index: number, activeRailFactor: number) => void =
    this.defaultItemBuilder;

  // Tracked purely to force a re-render when the theme changes; the actual
  // colour decision always goes through design/Theme.ets's own resolver
  // functions (see that file's header comment for this pattern).
  @StorageProp('colorMode') private sysColorMode: ColorMode = ColorMode.Light;
  @StorageProp('themeModeSetting') private themeSetting: ThemeModeSetting = 'system';

  /** `1` while this rail's focus group holds focus, `unfocusedRailFactor`
   * otherwise -- this file's `activeRailFactor`. */
  @State private activeRailFactor: number = DEFAULT_UNFOCUSED_RAIL_FACTOR;

  private setActive(active: boolean): void {
    // `fallback` is read into a local first (rather than inlining `active ?
    // 1 : this.unfocusedRailFactor` directly) purely to keep
    // `checks/arkts.mjs`'s lexical scan -- which naively flags any
    // `:\s*this\b` sequence as ArkTS's banned "'this' used as a type" --
    // from misreading a ternary's `: this...` else-branch as a type
    // position. Same documented ambiguity as `PosterCard.ets`'s
    // `setFocused()`.
    const fallback = this.unfocusedRailFactor;
    const next = active ? 1 : fallback;
    this.getUIContext().animateTo({ duration: INTERACTION_CARD_MS, curve: INTERACTION_CURVE }, () => {
      this.activeRailFactor = next;
    });
  }

  /** The heading is never itself focusable -- brief 5.8's "rail heading"
   * row lifts only because the RAIL is active, not because the heading has
   * its own focus state -- so its "local" focus percent is the constant
   * `1`, run through the same shared `effectiveFocusPercent` helper
   * `design/components/FocusLift.ets` documents every rail-hosted
   * component (explicitly including "a rail heading") must use. */
  private headingEffective(): number {
    return effectiveFocusPercent(1, this.activeRailFactor);
  }

  build() {
    const headingScale = 1 + (FOCUS_LIFT.railHeading.scale - 1) * this.headingEffective();
    const headingTranslateY = (FOCUS_LIFT.railHeading.translateY ?? 0) * this.headingEffective();
    const factor = this.activeRailFactor;
    // `gap` is read into a local first (rather than inlining `this.itemGap`
    // directly into the `List({ space: ... })` object literal below) purely
    // to keep `checks/arkts.mjs`'s lexical scan -- which naively flags any
    // `:\s*this\b` sequence as ArkTS's banned "'this' used as a type" --
    // from misreading an object-literal property value as a type position.
    // Same documented ambiguity as `PosterCard.ets`'s `setFocused()`.
    const gap = this.itemGap;

    Column({ space: Spacing.sm }) {
      if (this.heading.length > 0) {
        Text(this.heading)
          .fontSize(this.headingSize)
          .fontWeight(this.headingWeight)
          .fontColor(toResourceColor(activeColors().ink))
          .letterSpacing(this.headingSize * RAIL_HEADING_TRACKING_EM)
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
          .translateY(headingTranslateY)
          .scale({ x: headingScale, y: headingScale, centerX: 0, centerY: '50%' })
      }

      List({ space: gap }) {
        ForEach(
          this.items,
          (item: MediaRailItem, index: number) => {
            ListItem() {
              this.itemBuilder(item, index, factor)
            }
          },
          (item: MediaRailItem): string => item.id
        )
      }
      .listDirection(Axis.Horizontal)
      .scrollBar(BarState.Off)
      .edgeEffect(EdgeEffect.Spring)
      .padding({ left: RAIL_CLIP_INSET_START, bottom: RAIL_CLIP_INSET_BOTTOM })
      .margin({ left: -RAIL_CLIP_INSET_START, bottom: -RAIL_CLIP_INSET_BOTTOM })
      .focusScopeId(this.railId, true, true)
      .onFocus(() => {
        this.setActive(true);
      })
      .onBlur(() => {
        this.setActive(false);
      })
    }
    .alignItems(HorizontalAlign.Start)
    .width('100%')
  }
}
