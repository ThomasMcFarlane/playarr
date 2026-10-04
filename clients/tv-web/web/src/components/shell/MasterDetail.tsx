import type { ReactNode } from "react";

/**
 * Shared master-detail layout used by the TV/Movies-style pages: the selected
 * item's details on the LEFT, the browsable list on the RIGHT. On narrow
 * screens the details stack above the list. Selecting only changes the detail
 * pane; opening/playing is an explicit action inside it.
 */
export function MasterDetail({
  detail,
  detailLabel,
  children,
  className,
}: {
  detail: ReactNode;
  detailLabel: string;
  /** The list pane. */
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`master-detail${className ? ` ${className}` : ""}`}>
      <aside className="master-detail-pane" aria-label={detailLabel} aria-live="polite">
        {detail}
      </aside>
      <div className="master-detail-list">{children}</div>
    </div>
  );
}
