import { useRef, type ReactNode, type Ref, type UIEventHandler } from "react";
import { useScrollEdges } from "../../lib/useScrollEdges";

type DataAttributes = Record<`data-${string}`, string | boolean | undefined>;

export interface ScrollAreaProps {
  axis: "vertical" | "horizontal";
  /** `data-navigation-scroll-key`: the scroll-restoration key. */
  scrollKey: string;
  /** Layout only (a grid template, padding). `pageLayoutCss.test.ts` keeps colour and fade rules out of page CSS. */
  className?: string;
  /** Re-measure the edges when this changes (the list's identity). Defaults to the scroll key. */
  refreshKey?: string | number;
  /** The scrolling element, for pages that need to read or set its scroll position. */
  scrollRef?: Ref<HTMLDivElement>;
  onScroll?: UIEventHandler<HTMLDivElement>;
  viewportProps?: DataAttributes & { "aria-label"?: string; role?: string; tabIndex?: number };
  children: ReactNode;
}

/**
 * The one scroll container: a real native scroller with the edge fades built in. One fade on every axis, the
 * rail-panel glow (`page-layout.css`). It sets `data-tv-scroll-container` and the axis itself, so pages never do.
 */
export function ScrollArea({ axis, scrollKey, className, refreshKey, scrollRef, onScroll, viewportProps, children }: ScrollAreaProps) {
  const innerRef = useRef<HTMLDivElement | null>(null);
  const edges = useScrollEdges(innerRef, axis, refreshKey ?? scrollKey);
  const setRef = (node: HTMLDivElement | null) => {
    innerRef.current = node;
    if (typeof scrollRef === "function") scrollRef(node);
    else if (scrollRef) (scrollRef as { current: HTMLDivElement | null }).current = node;
  };
  return (
    <div
      className={`scroll-area is-${axis}${edges.start ? " can-scroll-start" : ""}${edges.end ? " can-scroll-end" : ""}`}
      data-scroll-area={scrollKey}
    >
      <div
        ref={setRef}
        className={`scroll-area-viewport${className ? ` ${className}` : ""}`}
        data-tv-scroll-container
        data-tv-scroll-axis={axis}
        data-navigation-scroll-key={scrollKey}
        onScroll={onScroll}
        {...viewportProps}
      >
        {children}
      </div>
    </div>
  );
}
