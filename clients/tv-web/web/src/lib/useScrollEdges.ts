import { useLayoutEffect, type RefObject } from "react";
import { attachScrollEdges, markFadeManaged, unmarkFadeManaged, type FadeAxis } from "./scrollEdgeFade";

/**
 * The scroll-edge fade for a component's own scroller (see `scrollEdgeFade.ts`). It measures in a layout effect, before
 * the first paint, so the fade is present the moment the scroller is, and keeps `data-fade-*` current without any
 * React state.
 */
export function useScrollEdges<T extends HTMLElement>(
  ref: RefObject<T | null>,
  axis: FadeAxis,
  refreshKey: string | number
): void {
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    markFadeManaged(element);
    const detach = attachScrollEdges(element, axis);
    return () => {
      detach();
      unmarkFadeManaged(element);
    };
  }, [axis, ref, refreshKey]);
}
