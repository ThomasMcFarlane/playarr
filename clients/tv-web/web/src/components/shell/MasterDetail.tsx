import { useRef, type ReactNode } from "react";
import { useScrollEdges } from "../../lib/useScrollEdges";

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
  detailKey = "",
}: {
  detail: ReactNode;
  detailLabel: string;
  /** The list pane. */
  children: ReactNode;
  className?: string;
  /** Changes whenever the detail content does, so the edge fades re-measure. */
  detailKey?: string | number;
}) {
  const paneRef = useRef<HTMLElement>(null);
  useScrollEdges(paneRef, "vertical", `${detailLabel}:${detailKey}`);
  return (
    <div className={`master-detail${className ? ` ${className}` : ""}`}>
      <div
        className="master-detail-pane-window"
      >
        <aside ref={paneRef} className="master-detail-pane" aria-label={detailLabel} aria-live="polite">
          {detail}
        </aside>
      </div>
      <div className="master-detail-list">{children}</div>
    </div>
  );
}
