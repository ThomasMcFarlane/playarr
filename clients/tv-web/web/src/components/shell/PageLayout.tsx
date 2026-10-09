import type { Key, ReactNode } from "react";
import type { PageId } from "../../lib/pageRegistry";
import { PageHeader, type PageHeaderProps } from "./PageHeader";
import { EmptyState, ErrorState, type EmptyStateProps, type ErrorStateProps } from "./States";
import { SkeletonState, type SkeletonKind } from "./Skeletons";

export type PageLayoutState =
  | { kind: "loading"; skeleton: SkeletonKind; label: string }
  | { kind: "empty"; props: EmptyStateProps }
  | { kind: "error"; props: ErrorStateProps & ({ onRetry?: undefined; retryLabel?: undefined } | { onRetry: () => void; retryLabel: string }) };

export interface PageLayoutProps {
  /** Stable id: the registry key and `data-page-id`. */
  pageId: PageId;
  /** `kind: "none"` is Home only (registry-checked): no back, no title and no actions. */
  header: PageHeaderProps | { kind: "none" };
  /** `panel` is the rail-panel stage (the rail-panel stage); `bleed` is the padded frame (the padded frame) for hero pages, Calendar and Folders. */
  body?: "panel" | "bleed";
  /** Background art and wash, unchanged visuals. */
  backdrop?: { art?: ReactNode; artKey?: Key; wash?: boolean };
  /** Exactly one of children or state. */
  state?: PageLayoutState;
  children?: ReactNode;
  ariaLabel?: string;
  /**
   * Page identity classes for the body content (`tv-library tv-directory ...`, `calendar-page`). Never header, pill
   * or fade styling: `pageLayoutCss.test.ts` keeps those in `page-layout.css`.
   */
  className?: string;
  bodyClassName?: string;
}

function StateView({ state }: { state: PageLayoutState }) {
  switch (state.kind) {
    case "loading":
      return <SkeletonState kind={state.skeleton} label={state.label} />;
    case "empty":
      return <EmptyState {...state.props} />;
    case "error":
      return <ErrorState {...state.props} />;
  }
}

/**
 * The one page frame for routed pages. The header is always rendered (so Back
 * is reachable while the page loads, fails or is empty) and the states render inside the body, never instead of the page.
 */
export function PageLayout({ pageId, header, body = "panel", backdrop, state, children, ariaLabel, className, bodyClassName }: PageLayoutProps) {
  const headerNode = "kind" in header && header.kind === "none" ? null : <PageHeader {...(header as PageHeaderProps)} />;
  const content = state ? (
    body === "panel" ? (
      <div className="tv-rail-panel tv-library-grid-panel page-layout-state">
        <StateView state={state} />
      </div>
    ) : (
      <div className="page-layout-state">
        <StateView state={state} />
      </div>
    )
  ) : (
    children
  );
  if (body === "bleed") {
    return (
      <section className={`page-shell${className ? ` ${className}` : ""}`} aria-label={ariaLabel} data-page-id={pageId} data-page-body="bleed">
        {backdrop?.art !== undefined ? (
          <div className="tv-key-art" key={backdrop.artKey}>
            {backdrop.art}
          </div>
        ) : null}
        {backdrop?.art !== undefined && backdrop.wash !== false ? <div className="tv-stage-wash" /> : null}
        {headerNode}
        <div className={`page-shell-body${bodyClassName ? ` ${bodyClassName}` : ""}`}>{content}</div>
      </section>
    );
  }
  return (
    <section className={className} aria-label={ariaLabel} data-page-id={pageId} data-page-body="panel">
      {backdrop?.art !== undefined ? (
        <div className="tv-key-art" key={backdrop.artKey}>
          {backdrop.art}
        </div>
      ) : null}
      {backdrop?.wash === false ? null : <div className="tv-stage-wash" />}
      {headerNode}
      {content}
    </section>
  );
}
