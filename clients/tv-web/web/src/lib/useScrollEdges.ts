import { useCallback, useEffect, useState, type RefObject } from "react";

type ScrollAxis = "horizontal" | "vertical";

export interface ScrollEdges {
  start: boolean;
  end: boolean;
}

const EDGE_TOLERANCE_PX = 3;

/**
 * Tracks whether a scroll viewport has content beyond either visible edge.
 * It observes both viewport and content changes, not only window resizes.
 */
export function useScrollEdges<T extends HTMLElement>(
  ref: RefObject<T | null>,
  axis: ScrollAxis,
  refreshKey: string | number
): ScrollEdges {
  const [edges, setEdges] = useState<ScrollEdges>({ start: false, end: false });

  const measure = useCallback(() => {
    const element = ref.current;
    if (!element) return;

    const position = axis === "horizontal" ? element.scrollLeft : element.scrollTop;
    const viewport = axis === "horizontal" ? element.clientWidth : element.clientHeight;
    const extent = axis === "horizontal" ? element.scrollWidth : element.scrollHeight;
    const next = {
      start: position > EDGE_TOLERANCE_PX,
      end: position + viewport < extent - EDGE_TOLERANCE_PX,
    };

    setEdges((current) =>
      current.start === next.start && current.end === next.end ? current : next
    );
  }, [axis, ref]);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    let frame: number | null = null;
    let trailing = 0;
    let stopped = false;
    const scheduleMeasure = () => {
      if (stopped || frame !== null) return;
      // Remote holds: no edge-chrome setState while keys are arriving (a
      // long-task source under TV CPUs). One trailing measure runs once the
      // hold settles so the fade edges are never left stale.
      if (document.body.dataset.inputMode === "remote") {
        window.clearTimeout(trailing);
        trailing = window.setTimeout(measure, 250);
        return;
      }
      frame = window.requestAnimationFrame(() => {
        frame = null;
        measure();
      });
    };

    const resizeObserver = new ResizeObserver(scheduleMeasure);
    // Observe the scroller only — per-child observers thrash on dense grids.
    resizeObserver.observe(element);

    const mutationObserver = new MutationObserver(scheduleMeasure);
    mutationObserver.observe(element, {
      childList: true,
      subtree: false,
    });

    element.addEventListener("scroll", scheduleMeasure, { passive: true });
    window.addEventListener("resize", scheduleMeasure, { passive: true });
    scheduleMeasure();

    return () => {
      stopped = true;
      window.clearTimeout(trailing);
      if (frame !== null) window.cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      mutationObserver.disconnect();
      element.removeEventListener("scroll", scheduleMeasure);
      window.removeEventListener("resize", scheduleMeasure);
    };
  }, [measure, ref, refreshKey]);

  return edges;
}
