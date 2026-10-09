import { useRef, type ReactNode } from "react";
import { useScrollEdges } from "../../lib/useScrollEdges";
import { TvRailSurface } from "./TvStage";

/**
 * The right-hand list panel of the Library stage: the same frosted full-height `tv-library-grid-panel` surface and the
 * same `tv-title-grid` scroller and `tv-title-grid-content` padding (`--library-rail-*`), with the shared edge fade.
 * Pages that list rows beside the left details panel (the calendar agenda) use this so the list has exactly the
 * Library's top, left, width and bottom. The scroller is a real browser scroll container.
 */
export function ListPanel({
  ariaLabel,
  scrollKey,
  refreshKey,
  contentClassName = "",
  children,
}: {
  ariaLabel: string;
  scrollKey: string;
  refreshKey: string | number;
  contentClassName?: string;
  children: ReactNode;
}) {
  const gridRef = useRef<HTMLDivElement>(null);
  useScrollEdges(gridRef, "vertical", refreshKey);
  return (
    <TvRailSurface className="tv-rail-panel tv-library-grid-panel is-list" mode="content" ariaLabel={ariaLabel}>
      <div
        className="tv-title-grid"
        ref={gridRef}
        data-tv-scroll-container
        data-tv-scroll-axis="vertical"
        data-navigation-scroll-key={scrollKey}
      >
        <div className={`tv-title-grid-content${contentClassName ? ` ${contentClassName}` : ""}`}>{children}</div>
      </div>
    </TvRailSurface>
  );
}
