import { useEffect, useLayoutEffect, useRef, type HTMLAttributes, type KeyboardEventHandler, type ReactNode, type Ref } from "react";
import { Button } from "../ui";
import { browserDrawerCloseEnv, playDrawerClose, restoreOpenerFocus, snapshotDrawer } from "./drawerClose";
import { isBackKey } from "../../lib/backKey";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * The ONE right-side pop-out used everywhere (Filters on every page, Calendar
 * subscription, playback settings, download quality, create playlist ...):
 * header with title and the shared round IconButton close, scrolling body,
 * optional footer actions, Tab focus trap, Esc/Back closes, and focus returns
 * to the opener. Pages drive `open` from the URL (`?panel=`) via
 * `usePanelParam`. `drawerAudit.test.ts` fails on ad-hoc drawer or close-button
 * markup outside this component.
 */
export function Drawer({ open = true, ...props }: DrawerProps) {
  return open ? <DrawerPanel {...props} /> : null;
}

type DrawerProps = {
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
  /** Extra attributes for the dialog element (TV scroll-container data attributes, click guards). */
  containerProps?: HTMLAttributes<HTMLElement> & { [key: `data-${string}`]: string | undefined };
};

/** The mounted drawer. Unmounting it (for any reason) plays the closing animation, see `drawerClose.ts`. */
function DrawerPanel({
  id,
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
  containerProps,
}: Omit<DrawerProps, "open">) {
  const localRef = useRef<HTMLElement | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const mountedRef = useRef(false);
  const customKeys = onKeyDown !== undefined;

  const openerRef = useRef<HTMLElement | null>(null);

  // Closing: whatever removes the drawer (Close button, Back or Escape, the scrim, the launcher toggle, a
  // route change), a frozen copy slides back out; focus returns to the launcher when it has gone.
  useLayoutEffect(() => {
    const node = localRef.current;
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (!node) return;
      const env = browserDrawerCloseEnv();
      const snapshot = snapshotDrawer(node);
      const opener = openerRef.current;
      // React StrictMode re-runs effects on mount; only a drawer that really went away animates out.
      queueMicrotask(() => {
        if (mountedRef.current) return;
        playDrawerClose(snapshot, env, () => restoreOpenerFocus(opener, env.document));
      });
    };
  }, []);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    openerRef.current = opener;
    let frame = 0;
    if (initialFocus === "close") {
      frame = window.requestAnimationFrame(() => closeRef.current?.focus({ preventScroll: true }));
    }
    const handleBack = (event: KeyboardEvent) => {
      if (!isBackKey(event)) return;
      // An open Select list (or any control marked `data-nested-back`) takes Back itself and closes first.
      if (event.target instanceof Element && event.target.closest("[data-nested-back]")) return;
      event.preventDefault();
      event.stopPropagation();
      onCloseRef.current();
    };
    if (!customKeys) window.addEventListener("keydown", handleBack, true);
    return () => {
      window.cancelAnimationFrame(frame);
      if (!customKeys) {
        window.removeEventListener("keydown", handleBack, true);
      }
    };
  }, [initialFocus, customKeys]);

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
      {...containerProps}
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
