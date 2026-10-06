/**
 * The pure half of `TvMediaTrack.tsx`'s edge-fade behaviour -- whether the
 * rail currently has more content off-screen to the left/start and/or the
 * right/end, so the caller can fade the corresponding edge in or out.
 * Ported from `clients/tv-web/web/src/lib/useScrollEdges.ts`'s own
 * `measure()` calculation, which reduces to exactly this once you strip
 * away the DOM-specific plumbing (`ResizeObserver`/`MutationObserver`/
 * `scroll` listeners) that has no equivalent here: RN's `FlashList`
 * reports the same three numbers this needs (offset, viewport, content
 * extent) directly on its own `onScroll` event, via
 * `nativeEvent.{contentOffset,layoutMeasurement,contentSize}`, so there is
 * no observer machinery to port at all -- `TvMediaTrack.tsx` just calls
 * this function from its `onScroll` handler.
 */

export interface ScrollEdges {
  /** True once the rail has been scrolled far enough that content exists before the current viewport -- fade in a "can scroll back" edge. */
  start: boolean;
  /** True while content still exists beyond the current viewport's trailing edge -- fade in a "can scroll further" edge. */
  end: boolean;
}

/** Matches `useScrollEdges.ts`'s own `EDGE_TOLERANCE_PX` exactly -- small enough to be visually meaningless, large enough to absorb the sub-pixel rounding noise a real scroll position reports. */
export const SCROLL_EDGE_TOLERANCE_PX = 3;

/**
 * `offset`/`viewport`/`extent` are, respectively, `contentOffset.x`,
 * `layoutMeasurement.width` and `contentSize.width` off a horizontal
 * `onScroll` event (or the `.y`/`.height` triple for a vertical one --
 * this function is axis-agnostic, exactly like the web version's own
 * `axis` parameter reduces to once the DOM element properties are already
 * resolved to plain numbers by the caller).
 */
export function computeScrollEdges(
  offset: number,
  viewport: number,
  extent: number,
  tolerancePx: number = SCROLL_EDGE_TOLERANCE_PX
): ScrollEdges {
  return {
    start: offset > tolerancePx,
    end: offset + viewport < extent - tolerancePx,
  };
}
