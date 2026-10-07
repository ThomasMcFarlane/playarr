/**
 * The focus adapter. Design doc §4.4 is the full rationale for why this
 * file is small: Vega's own Cartesian focus engine already does weighted-
 * distance directional resolution natively and apps cannot override
 * default D-pad behaviour, so tv-web's 741-line useTvNavigation.ts (which
 * exists purely to *reimplement* that engine over the DOM) has no Vega
 * equivalent to port at all -- there is nothing left to do here except
 * expose `TVFocusGuideView`/`FocusManager` under names the rest of the app
 * can use without importing `@amazon-devices/react-native-kepler` directly.
 *
 * Every one of these is a thin, direct pass-through with no branching logic
 * of its own -- there is nothing here a unit test would meaningfully cover
 * beyond "does calling it call the underlying Kepler API", which is exactly
 * the kind of assertion that needs a real Kepler host to mean anything (see
 * design doc §8.2). Downstream screens are this file's real test: the
 * moment a rail or a modal renders and focus behaves as designed doc §4.4
 * describes, this file is doing its job.
 */
import React from 'react';
import {findNodeHandle} from 'react-native';
import {FocusManager, TVFocusGuideView} from '@amazon-devices/react-native-kepler';

export type FocusDirection = 'up' | 'down' | 'left' | 'right';

export interface TvFocusScopeProps {
  /** Sends focus to the first focusable descendant as soon as this scope mounts (TVFocusGuideView's own `autoFocus`). */
  autoFocus?: boolean;
  /** Directions the D-pad may not escape this scope through -- a modal or a single rail's own edge, per design doc §4.4's edge-stop mapping. */
  trap?: ReadonlyArray<FocusDirection>;
  /** Explicit focus destinations, for the rare case Vega's default nearest-neighbour resolution picks the wrong descendant. */
  destinations?: ReadonlyArray<React.RefObject<unknown>>;
  style?: React.ComponentProps<typeof TVFocusGuideView>['style'];
  children: React.ReactNode;
}

/**
 * `TVFocusGuideView` wrapper -- the Vega equivalent of tv-web's
 * `data-tv-focus-default` / `data-tv-scroll-container` / `data-tv-edge-stop-*`
 * data attributes (design doc §4.4's table). Every screen that needs a
 * focus boundary (a rail, a modal, the settings list) renders one of these
 * rather than importing `TVFocusGuideView` itself.
 */
export function TvFocusScope(props: TvFocusScopeProps): React.ReactElement {
  const {autoFocus, trap, destinations, style, children} = props;
  return (
    <TVFocusGuideView
      style={style}
      autoFocus={autoFocus}
      trapFocusUp={trap?.includes('up')}
      trapFocusDown={trap?.includes('down')}
      trapFocusLeft={trap?.includes('left')}
      trapFocusRight={trap?.includes('right')}
      // TVFocusGuideView's own `destinations` prop predates function
      // components -- it is typed for the class-component era
      // (`React.Component<any, any> | React.ComponentClass<any> | number |
      // null`), not for a `RefObject`'s `.current` off a modern function-
      // component host-element ref. Every real caller of this prop in
      // practice passes host-element refs, which this cast reflects
      // honestly rather than fighting the class-component-shaped type with
      // a more elaborate (and no more correct) structural workaround.
      destinations={
        destinations?.map((ref) => ref.current).filter((value) => value !== null) as
          | Array<number | React.Component<any, any> | React.ComponentClass<any> | null>
          | undefined
      }
    >
      {children}
    </TVFocusGuideView>
  );
}

function nodeTag(ref: React.RefObject<unknown>): number | null {
  return findNodeHandle(ref.current as never);
}

/** Imperatively sends focus to a specific node -- e.g. the Retry button after LinkScreen's poll fails. */
export function focusNode(ref: React.RefObject<unknown>): void {
  const tag = nodeTag(ref);
  if (tag !== null) FocusManager.focus(tag);
}

/** Imperatively removes focus from a node, without moving it anywhere in particular. */
export function blurNode(ref: React.RefObject<unknown>): void {
  const tag = nodeTag(ref);
  if (tag !== null) FocusManager.blur(tag);
}

/**
 * The modal focus trap from design doc §4.4's table:
 * `FocusManager.setFocusRoot(tag, true)` confines the D-pad to `ref`'s
 * subtree until released (`trapped = false`) -- e.g. a confirmation dialog
 * over WorkDetailScreen must not let Down escape back into the page behind
 * it.
 */
export function trapFocusWithin(ref: React.RefObject<unknown>, trapped: boolean): void {
  const tag = nodeTag(ref);
  if (tag !== null) FocusManager.setFocusRoot(tag, trapped);
}

/**
 * The currently focused native view's tag, for the rare case a screen
 * needs to know rather than just react to focus/blur events on its own
 * nodes. `undefined` -- not a sentinel like `-1` or `0` -- when nothing is
 * focused yet, matching `FocusManager.getFocused()`'s own real return type
 * exactly (an earlier draft of this file assumed a non-optional `number`
 * here before the real installed `.d.ts` had been checked).
 */
export function getFocusedTag(): number | undefined {
  return FocusManager.getFocused();
}
