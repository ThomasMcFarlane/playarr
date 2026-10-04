import type { ReactNode } from "react";
import { PageHeader, type PageHeaderProps } from "./PageHeader";

/**
 * Canonical page frame for pages that own their whole canvas: the shared
 * {@link PageHeader} (back top-left, title, right-side actions) above a body
 * that always stays clear of the shell's persistent chrome. The profile chip
 * sits at the bottom-left of every screen, so the body reserves
 * `--page-safe-bottom` and `--page-safe-left`; nothing may render beneath it.
 */
export function PageShell({
  ariaLabel,
  className,
  bodyClassName,
  children,
  ...header
}: PageHeaderProps & {
  ariaLabel?: string;
  bodyClassName?: string;
  children: ReactNode;
}) {
  return (
    <section className={`page-shell${className ? ` ${className}` : ""}`} aria-label={ariaLabel}>
      <PageHeader {...header} />
      <div className={`page-shell-body${bodyClassName ? ` ${bodyClassName}` : ""}`}>{children}</div>
    </section>
  );
}
