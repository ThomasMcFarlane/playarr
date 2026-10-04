import { useEffect, useRef, type KeyboardEventHandler, type ReactNode, type Ref } from "react";
import { Button } from "../ui";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function isBack(event: KeyboardEvent): boolean {
  return (
    event.key === "Escape" ||
    event.key === "BrowserBack" ||
    event.key === "GoBack" ||
    event.keyCode === 10009 ||
    event.keyCode === 461
  );
}

/**
 * The ONE right-side pop-out used everywhere (Filters on every page, Calendar
 * subscription, playback settings, download quality, create playlist ...):
 * header with title and the shared round IconButton close, scrolling body,
 * optional footer actions, Tab focus trap, Esc/Back closes, and focus returns
 * to the opener. Pages drive `open` from the URL (`?panel=`) via
 * `usePanelParam`. `drawerAudit.test.ts` fails on ad-hoc drawer or close-button
 * markup outside this component.
 */
export function Drawer({
  id,
  open = true,
  title,
  kicker,
  ariaLabel,
  closeLabel,
  onClose,
  children,
  footer,
  className,
  drawerRef,
  titleId,
  modal = true,
  initialFocus = "close",
  onKeyDown,
}: {
  id?: string;
  open?: boolean;
  title: ReactNode;
  kicker?: ReactNode;
  ariaLabel?: string;
  closeLabel: string;
  onClose: () => void;
  children: ReactNode;
  /** Footer actions (rendered below the body, e.g. Cancel / Save). */
  footer?: ReactNode;
  /** Page-specific styling hooks only; the shape never changes. */
  className?: string;
  drawerRef?: Ref<HTMLElement>;
  /** Labels the dialog by its heading instead of `ariaLabel`. */
  titleId?: string;
  modal?: boolean;
  /** `"none"` when the content manages its own initial focus. */
  initialFocus?: "close" | "none";
  /**
   * Replaces the built-in key handling (focus trap, Esc/Back) for drawers whose
   * content owns its keyboard model; the handler must close on Esc/Back itself.
   */
  onKeyDown?: KeyboardEventHandler<HTMLElement>;
}) {
  const localRef = useRef<HTMLElement | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const customKeys = onKeyDown !== undefined;

  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement as HTMLElement | null;
    let frame = 0;
    if (initialFocus === "close") {
      frame = window.requestAnimationFrame(() => closeRef.current?.focus({ preventScroll: true }));
    }
    const handleBack = (event: KeyboardEvent) => {
      if (!isBack(event)) return;
      event.preventDefault();
      event.stopPropagation();
      onCloseRef.current();
    };
    if (!customKeys) window.addEventListener("keydown", handleBack, true);
    return () => {
      window.cancelAnimationFrame(frame);
      if (!customKeys) {
        window.removeEventListener("keydown", handleBack, true);
        if (opener && document.contains(opener)) opener.focus({ preventScroll: true });
      }
    };
  }, [open, initialFocus, customKeys]);

  if (!open) return null;

  function trapTab(event: React.KeyboardEvent<HTMLElement>) {
    if (event.key !== "Tab") return;
    const nodes = [...(localRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])].filter(
      (node) => node.offsetParent !== null
    );
    if (nodes.length === 0) return;
    const first = nodes[0]!;
    const last = nodes[nodes.length - 1]!;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <aside
      id={id}
      ref={(node) => {
        localRef.current = node;
        if (typeof drawerRef === "function") drawerRef(node);
        else if (drawerRef) (drawerRef as { current: HTMLElement | null }).current = node;
      }}
      className={`tv-filter-drawer drawer${className ? ` ${className}` : ""}`}
      role="dialog"
      aria-modal={modal ? true : undefined}
      aria-label={titleId ? undefined : ariaLabel}
      aria-labelledby={titleId}
      onKeyDown={onKeyDown ?? trapTab}
    >
      <header className="drawer-header">
        <div className="drawer-heading">
          {kicker ? <p>{kicker}</p> : null}
          <h2 id={titleId}>{title}</h2>
        </div>
        <Button ref={closeRef} variant="icon" className="drawer-close" aria-label={closeLabel} onClick={onClose}>
          <span aria-hidden="true">×</span>
        </Button>
      </header>
      <div className="drawer-body">{children}</div>
      {footer ? <footer className="drawer-footer">{footer}</footer> : null}
    </aside>
  );
}
