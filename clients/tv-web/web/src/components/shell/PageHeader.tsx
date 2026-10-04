import { useLayoutEffect, useRef, useState } from "react";
import type { HTMLAttributes, ReactNode, Ref } from "react";
import { detailFitsInline } from "../../lib/pageHeaderLayout";
import { Button, ButtonLink } from "../ui";
import { FiltersButton, PanelButton } from "./FiltersDrawer";

export interface FiltersSlot {
  label: string;
  open: boolean;
  onToggle: () => void;
  /** Id of the drawer this button controls. */
  controls: string;
  activeCount?: number;
  buttonRef?: Ref<HTMLButtonElement>;
  buttonProps?: Record<`data-${string}`, string | boolean | undefined>;
}

export interface PanelSlot {
  id: string;
  label: string;
  icon: ReactNode;
  open: boolean;
  onToggle: () => void;
  controls: string;
  buttonRef?: Ref<HTMLButtonElement>;
  buttonProps?: Record<`data-${string}`, string | boolean | undefined>;
}

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
  /**
   * The page's Filters. Rendered by the header itself in the one shared slot
   * (top-right), so every filterable page looks and sits identically.
   */
  filters?: FiltersSlot;
  /** Secondary panel openers rendered immediately left of Filters in the same style (Playlists' Create, Calendar subscription). */
  panelButtons?: readonly PanelSlot[];
  /** Page navigation (e.g. calendar previous/today/next) placed left of the Filters column. */
  navigation?: ReactNode;
  /** Any further right-side actions, left of the Filters column. */
  actions?: ReactNode;
  /** Extra attributes for the back control (focus hooks, refs are not supported). */
  /** Ref to the back control (focus management). */
  backRef?: Ref<HTMLAnchorElement>;
  backProps?: HTMLAttributes<HTMLElement> & Record<`data-${string}`, string | boolean | undefined>;
}

/** Width of the content itself, independent of how wide its (possibly wrapped) box currently is. */
function naturalWidth(element: HTMLElement): number {
  const range = document.createRange();
  range.selectNodeContents(element);
  return range.getBoundingClientRect().width;
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
  filters,
  panelButtons,
  navigation,
  backProps,
  backRef,
}: PageHeaderProps) {
  const headerRef = useRef<HTMLElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const detailRef = useRef<HTMLSpanElement>(null);
  const actionsRef = useRef<HTMLDivElement>(null);
  const [wrapped, setWrapped] = useState(false);

  // Measure against the real clock and actions so the detail never renders
  // beneath them; wrap it under the title when it does not fit.
  useLayoutEffect(() => {
    const header = headerRef.current;
    const detailEl = detailRef.current;
    if (!header || !detailEl) return;
    const measure = () => {
      const style = getComputedStyle(header);
      const gap = parseFloat(style.columnGap) || 0;
      const clock = document.querySelector<HTMLElement>(".app-clock");
      const obstacles: number[] = [];
      if (clock && getComputedStyle(clock).display !== "none") obstacles.push(clock.getBoundingClientRect().left);
      if (actionsRef.current) obstacles.push(actionsRef.current.getBoundingClientRect().left);
      const detailStyle = getComputedStyle(detailEl);
      const wrappedNow = header.classList.contains("is-detail-wrapped");
      // The wrapped variant drops the divider padding, so add it back for the inline estimate.
      const pad = wrappedNow ? parseFloat(getComputedStyle(header).getPropertyValue("--page-header-divider-pad")) || 20 : parseFloat(detailStyle.paddingLeft) + parseFloat(detailStyle.borderLeftWidth);
      const fits = detailFitsInline({
        headerLeft: header.getBoundingClientRect().left,
        backWidth: (header.firstElementChild as HTMLElement).getBoundingClientRect().width,
        titleWidth: titleRef.current?.getBoundingClientRect().width ?? 0,
        detailWidth: naturalWidth(detailEl) + pad,
        gap,
        obstacles,
      });
      setWrapped(!fits);
    };
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(header);
    observer?.observe(document.body);
    window.addEventListener("resize", measure);
    void document.fonts?.ready.then(measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
    };
  });

  const hasActions = Boolean(actions || filters || navigation || panelButtons?.length);
  const classes = [
    "tv-library-heading",
    "page-header",
    hasActions ? "has-actions" : "",
    wrapped && detail ? "is-detail-wrapped" : "",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <header ref={headerRef} className={classes}>
      {onBack ? (
        <Button
          variant="icon"
          className="tv-page-back"
          aria-label={backLabel}
          onClick={onBack}
          ref={backRef as Ref<HTMLButtonElement> | undefined}
          {...backProps}
        >
          <span aria-hidden="true">←</span>
        </Button>
      ) : (
        <ButtonLink
          to={backTo}
          variant="icon"
          className="tv-page-back"
          aria-label={backLabel}
          ref={backRef}
          {...backProps}
        >
          <span aria-hidden="true">←</span>
        </ButtonLink>
      )}
      <h1 ref={titleRef}>{title}</h1>
      {detail ? (
        <span ref={detailRef} className={`page-header-detail${detailClassName ? ` ${detailClassName}` : ""}`}>
          {detail}
        </span>
      ) : null}
      {hasActions ? (
        <div ref={actionsRef} className="page-header-actions">
          {navigation}
          {actions}
          {filters || panelButtons?.length ? (
            <div className="page-header-stack">
              {panelButtons?.map((panel) => (
                <PanelButton key={panel.id} {...panel} />
              ))}
              {filters ? <FiltersButton {...filters} /> : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </header>
  );
}
