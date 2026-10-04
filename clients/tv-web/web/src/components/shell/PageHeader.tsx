import type { HTMLAttributes, ReactNode, Ref } from "react";
import { Link } from "react-router-dom";

export interface PageHeaderProps {
  /** Large page title (`<h1>`). */
  title: ReactNode;
  /** Accessible label for the back control. */
  backLabel: string;
  /** Route the back control links to. Defaults to Home. Ignored when `onBack` is set. */
  backTo?: string;
  /** Imperative back handler (settings, nested detail views). */
  onBack?: () => void;
  /** Secondary text after the divider (counts, section name, breadcrumb). */
  detail?: ReactNode;
  /** Extra class on the detail wrapper (page-specific typography). */
  detailClassName?: string;
  /** Extra class names for page-specific tweaks; the base layout never changes. */
  className?: string;
  /** Right-side actions, normally a {@link FiltersButton}. */
  actions?: ReactNode;
  /** Stack the actions vertically (Filters above secondary panel buttons). */
  stackActions?: boolean;
  /** Extra attributes for the back control (focus hooks, refs are not supported). */
  /** Ref to the back control (focus management). */
  backRef?: Ref<HTMLAnchorElement>;
  backProps?: HTMLAttributes<HTMLElement> & Record<`data-${string}`, string | boolean | undefined>;
}

/**
 * The one canonical page header: back button at the top left, large title, an
 * optional divider + breadcrumb/detail, and right-aligned page actions
 * (Filters). Every routed page renders its heading through this component;
 * `pageShell.test.ts` enforces that, so pages cannot drift.
 */
export function PageHeader({
  title,
  backLabel,
  backTo = "/",
  onBack,
  detail,
  detailClassName,
  className,
  actions,
  stackActions,
  backProps,
  backRef,
}: PageHeaderProps) {
  const classes = ["tv-library-heading", "page-header", actions ? "has-actions" : "", className ?? ""]
    .filter(Boolean)
    .join(" ");
  return (
    <header className={classes}>
      {onBack ? (
        <button type="button" className="tv-page-back" aria-label={backLabel} onClick={onBack}
          ref={backRef as Ref<HTMLButtonElement> | undefined} {...backProps}>
          <span aria-hidden="true">←</span>
        </button>
      ) : (
        <Link to={backTo} className="tv-page-back" aria-label={backLabel} ref={backRef} {...backProps}>
          <span aria-hidden="true">←</span>
        </Link>
      )}
      <h1>{title}</h1>
      {detail ? <span className={`page-header-detail${detailClassName ? ` ${detailClassName}` : ""}`}>{detail}</span> : null}
      {actions ? <div className={`page-header-actions${stackActions ? " is-stacked" : ""}`}>{actions}</div> : null}
    </header>
  );
}
