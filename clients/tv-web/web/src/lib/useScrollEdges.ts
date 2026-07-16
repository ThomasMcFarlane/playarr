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
    let stopped = false;
    const scheduleMeasure = () => {
      if (stopped || frame !== null) return;
      frame = window.requestAnimationFrame(() => {
        frame = null;
        measure();
      });
    };

    const resizeObserver = new ResizeObserver(scheduleMeasure);
    const observeSizes = () => {
      resizeObserver.disconnect();
      resizeObserver.observe(element);
      for (const child of element.children) {
        if (child instanceof HTMLElement) resizeObserver.observe(child);
      }
    };
    observeSizes();

    const mutationObserver = new MutationObserver(() => {
      observeSizes();
      scheduleMeasure();
    });
    mutationObserver.observe(element, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    element.addEventListener("scroll", scheduleMeasure, { passive: true });
    element.addEventListener("load", scheduleMeasure, true);
    window.addEventListener("resize", scheduleMeasure, { passive: true });
    void document.fonts?.ready.then(scheduleMeasure);
    scheduleMeasure();

    return () => {
      stopped = true;
      if (frame !== null) window.cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      mutationObserver.disconnect();
      element.removeEventListener("scroll", scheduleMeasure);
      element.removeEventListener("load", scheduleMeasure, true);
      window.removeEventListener("resize", scheduleMeasure);
    };
  }, [measure, ref, refreshKey]);

  return edges;
}
