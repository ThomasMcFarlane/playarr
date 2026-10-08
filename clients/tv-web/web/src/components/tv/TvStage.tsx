import {
  forwardRef,
  useRef,
  type FocusEventHandler,
  type Key,
  type ReactNode,
} from "react";
import { useScrollEdges } from "../../lib/useScrollEdges";
import { LanguageDropdown } from "../LanguageDropdown";
import { ThemeDropdown } from "../ThemeDropdown";

const PLAYARR_ICON_URL = `${import.meta.env.BASE_URL}playarr-icon.svg`;

export function TvStageChrome({
  backLabel,
  onBack,
}: {
  backLabel?: string;
  onBack?: () => void;
}) {
  return (
    <header className="tv-stage-chrome">
      <span className="tv-stage-chrome-logo" aria-hidden="true">
        <img className="app-logo-icon" src={PLAYARR_ICON_URL} alt="" />
      </span>
      {backLabel && onBack ? (
        <div className="tv-library-heading tv-stage-chrome-heading">
          <button
            type="button"
            className="tv-page-back tv-stage-chrome-back"
            aria-label={backLabel}
            onClick={onBack}
          >
            <span aria-hidden="true">←</span>
          </button>
        </div>
      ) : null}
      <div className="tv-stage-chrome-controls">
        <ThemeDropdown className="tv-stage-chrome-theme" />
        <LanguageDropdown className="tv-stage-chrome-language" />
      </div>
    </header>
  );
}

export type TvRailSurfaceMode = "vertical-tracks" | "static-track" | "content";

export const TvRailSurface = forwardRef<
  HTMLDivElement,
  {
    className?: string;
    ariaLabel?: string;
    mode?: TvRailSurfaceMode;
    scrollKey?: string;
    children: ReactNode;
  }
>(function TvRailSurface(
  {
    className = "",
    ariaLabel,
    mode = "content",
    scrollKey,
    children,
  },
  ref
) {
  const scrollable = mode === "vertical-tracks";
  return (
    <div
      ref={ref}
      className={`tv-rail-surface is-${mode}${className ? ` ${className}` : ""}`}
      aria-label={ariaLabel}
      data-tv-scroll-container={scrollable ? true : undefined}
      data-tv-scroll-axis={scrollable ? "vertical" : undefined}
      data-navigation-scroll-key={scrollable ? scrollKey : undefined}
    >
      {children}
    </div>
  );
});

export function TvMediaTrack({
  title,
  meta,
  active = false,
  ariaLabel,
  scrollKey,
  itemsKey,
  dataTrackId,
  rightEdgeTarget,
  className = "",
  onFocusCapture,
  overlay,
  headingAction,
  children,
}: {
  title: ReactNode;
  meta?: ReactNode;
  active?: boolean;
  ariaLabel?: string;
  scrollKey: string;
  itemsKey: string;
  dataTrackId?: string;
  rightEdgeTarget?: string;
  className?: string;
  onFocusCapture?: FocusEventHandler<HTMLElement>;
  overlay?: ReactNode;
  /** A button at the right of the heading (for example the season Download action). */
  headingAction?: ReactNode;
  children: ReactNode;
}) {
  const railRef = useRef<HTMLDivElement>(null);
  useScrollEdges(railRef, "horizontal", itemsKey);

  return (
    <section
      className={`tv-media-track${active ? " is-active" : ""}${
        className ? ` ${className}` : ""
      }`}
      aria-label={ariaLabel}
      onFocusCapture={onFocusCapture}
      data-tv-track-id={dataTrackId}
    >
      <header className="tv-media-track-heading">
        <div>
          <h2>{title}</h2>
          {meta !== undefined ? <span>{meta}</span> : null}
        </div>
        {headingAction}
      </header>
      <div className="tv-media-track-window">
        <div
          ref={railRef}
          className="tv-media-track-scroll tv-episode-rail"
          data-tv-scroll-container
          data-tv-scroll-axis="horizontal"
          data-navigation-scroll-key={scrollKey}
          data-tv-edge-target-right={rightEdgeTarget}
        >
          {children}
        </div>
      </div>
      {overlay}
    </section>
  );
}
