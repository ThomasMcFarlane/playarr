import type { HTMLAttributes, ReactNode } from "react";

export interface DetailsPanelProps extends Omit<HTMLAttributes<HTMLElement>, "title"> {
  /** Kind or genre line above the title. */
  eyebrow?: ReactNode;
  title: ReactNode;
  /** Metadata line content (year, genres, ...): spans. */
  meta?: ReactNode;
  overview?: ReactNode;
  /** Slot for `StatusPill`s. */
  pills?: ReactNode;
  /** Slot for the shared `Button`s. */
  actions?: ReactNode;
  /** `stage`: the absolute left column of Home and Library. `flow`: in the normal flow (calendar agenda). */
  placement?: "stage" | "flow";
  /** Extra content below the actions. */
  children?: ReactNode;
}

/**
 * The shared left details panel: eyebrow, title, metadata line, description, status pills and actions. It is
 * purely presentational. The background artwork belongs to the page frame (`PageLayout` `backdrop`).
 */
export function DetailsPanel({
  eyebrow,
  title,
  meta,
  overview,
  pills,
  actions,
  placement = "stage",
  className,
  children,
  ...rest
}: DetailsPanelProps) {
  return (
    <aside className={`details-panel is-${placement}${className ? ` ${className}` : ""}`} {...rest}>
      {eyebrow ? <p className="tv-provider">{eyebrow}</p> : null}
      <h2 className="details-panel-title">{title}</h2>
      {meta ? <p className="tv-preview-meta">{meta}</p> : null}
      {pills ? <div className="details-panel-pills">{pills}</div> : null}
      {overview ? <p className="tv-preview-overview">{overview}</p> : null}
      {actions ? <div className="details-panel-actions">{actions}</div> : null}
      {children}
    </aside>
  );
}
