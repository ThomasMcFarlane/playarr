import { useRef, type ReactNode, type Ref, type UIEventHandler } from "react";
import { useScrollEdges } from "../../lib/useScrollEdges";

type DataAttributes = Record<`data-${string}`, string | boolean | undefined>;

export interface ScrollAreaProps {
  axis: "vertical" | "horizontal";
  /** `data-navigation-scroll-key`: the scroll-restoration key. */
  scrollKey: string;
  /** Layout only (a grid template, padding). `pageLayoutCss.test.ts` keeps colour and fade rules out of page CSS. */
  className?: string;
  /** Layout only, on the outer window (negative margins, flex sizing). Never colour or fade rules. */
  windowClassName?: string;
  /** Re-measure the edges when this changes (the list's identity). Defaults to the scroll key. */
  refreshKey?: string | number;
  /** The scrolling element, for pages that need to read or set its scroll position. */
  scrollRef?: Ref<HTMLDivElement>;
  onScroll?: UIEventHandler<HTMLDivElement>;
  viewportProps?: DataAttributes & {
    "aria-label"?: string;
    "aria-live"?: "off" | "polite" | "assertive";
    "aria-busy"?: boolean;
    role?: string;
    tabIndex?: number;
  };
  children: ReactNode;
}

/**
 * The one scroll container: a real native scroller with the edge fade built in: the one shared mask
 * (`page-layout.css`, driven by `useScrollEdges`). It sets `data-tv-scroll-container` and the axis itself, so pages never do.
 */
export function ScrollArea({ axis, scrollKey, className, windowClassName, refreshKey, scrollRef, onScroll, viewportProps, children }: ScrollAreaProps) {
  const innerRef = useRef<HTMLDivElement | null>(null);
  useScrollEdges(innerRef, axis, refreshKey ?? scrollKey);
  const setRef = (node: HTMLDivElement | null) => {
    innerRef.current = node;
    if (typeof scrollRef === "function") scrollRef(node);
    else if (scrollRef) (scrollRef as { current: HTMLDivElement | null }).current = node;
  };
  return (
    <div
      className={`scroll-area is-${axis}${windowClassName ? ` ${windowClassName}` : ""}`}
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
