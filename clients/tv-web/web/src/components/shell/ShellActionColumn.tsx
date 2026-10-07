import { createContext, useContext, useState } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * The shell-level action column (owner ruling, 8 October 2026). Every page's side-panel buttons (Filters, Create,
 * Calendar link, ...) render here, stacked vertically at the right edge in the 30 September launcher position and look.
 * The app shell owns the one column element; pages register their buttons through {@link PageHeader}, which portals
 * them in. A page never positions these buttons itself.
 */
const ShellActionColumnContext = createContext<HTMLElement | null>(null);

/** Renders the column once, inside the app shell, and exposes it to the pages below. */
export function ShellActionColumnProvider({ children }: { children: ReactNode }) {
  const [column, setColumn] = useState<HTMLElement | null>(null);
  return (
    <ShellActionColumnContext.Provider value={column}>
      {children}
      <div ref={setColumn} className="shell-action-column" data-shell-action-column />
    </ShellActionColumnContext.Provider>
  );
}

/** Places `children` in the shell action column. Without a shell (tests, isolated renders) they render in place. */
export function ShellActionColumnSlot({ children }: { children: ReactNode }) {
  const column = useContext(ShellActionColumnContext);
  return column ? createPortal(children, column) : <>{children}</>;
}
