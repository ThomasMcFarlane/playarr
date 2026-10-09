import {
  useRef,
  type CSSProperties,
  type HTMLAttributes,
  type ReactNode,
  type RefObject,
} from "react";
import { useScrollEdges } from "../../lib/useScrollEdges";
import { TvRailSurface } from "./TvStage";

/**
 * The right-hand list panel of the Library stage: the same frosted full-height `tv-library-grid-panel` surface and the
 * same `tv-title-grid` scroller and `tv-title-grid-content` padding (`--library-rail-*`), with the shared edge fade.
 * Library and the calendar agenda both render through this one component so the list has exactly the same top, left,
 * width and bottom. The scroller is a real browser scroll container. Library passes its own `gridRef` because it drives the
 * scroller imperatively; the panel still attaches the edge fade to it.
 */
export function ListPanel({
  ariaLabel,
  scrollKey,
  refreshKey,
  axis = "vertical",
  panelClassName = "is-list",
  contentClassName = "",
  contentStyle,
  gridRef,
  gridProps,
  overlay,
  footer,
  children,
}: {
  ariaLabel: string;
  scrollKey: string;
  refreshKey?: string | number;
  axis?: "vertical" | "horizontal";
  panelClassName?: string;
  contentClassName?: string;
  contentStyle?: CSSProperties;
  gridRef?: RefObject<HTMLDivElement | null>;
  gridProps?: HTMLAttributes<HTMLDivElement> &
    Record<`data-${string}`, unknown>;
  overlay?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
}) {
  const ownRef = useRef<HTMLDivElement>(null);
  const ref = gridRef ?? ownRef;
  useScrollEdges(ref, axis, refreshKey ?? scrollKey);
  return (
    <TvRailSurface
      className={`tv-rail-panel tv-library-grid-panel ${panelClassName}`}
      mode="content"
      ariaLabel={ariaLabel}
    >
      {overlay}
      <div
        {...gridProps}
        className="tv-title-grid"
        ref={ref as RefObject<HTMLDivElement>}
        data-tv-scroll-container
        data-tv-scroll-axis={axis}
        data-navigation-scroll-key={scrollKey}
      >
        <div
          className={`tv-title-grid-content${contentClassName ? ` ${contentClassName}` : ""}`}
          style={contentStyle}
        >
          {children}
        </div>
      </div>
      {footer}
    </TvRailSurface>
  );
}
