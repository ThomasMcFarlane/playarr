import { isValidElement, useLayoutEffect, useRef, useState } from "react";
import type { HTMLAttributes, ReactNode, Ref } from "react";
import { detailFitsInline } from "../../lib/pageHeaderLayout";
import { Button, ButtonLink } from "../ui";
import { PageActionStack, PageHeaderActions, type PageAction } from "./PageActions";
import type { ActionIcon } from "./icons";

type BackProps = { label: string } & ({ to: string } | { onBack: () => void });

export interface PageHeaderProps {
  /** Large page title (`<h1>`). */
  title: ReactNode;
  /**
   * Secondary text after the divider (counts, section name, breadcrumb). In the `detail` variant it is the item title.
   * `{ title, description }` is the two-line section detail (Settings): the section name over its description.
   */
  detail?: ReactNode | SectionDetail;
  /** Phones show either the page title or the detail, never both (Settings: the list shows the title, a section the detail). */
  mobileShow?: "title" | "detail";
  /** Back control: where it goes, and its accessible label. Home is the default destination. */
  back?: BackProps;
  /**
   * The page's actions, in any order. The navigation group and status text draw in the header row; panel, link and Filters
   * pills draw in the shell action column, Filters last (owner ruling 2026-10-08, Q1b).
   */
  actions?: PageAction[];
  /** `detail` is the detail-page variant: the detail text is the item title, bold. */
  variant?: "page" | "detail";
  /** Ref to the back control (focus management). */
  backRef?: Ref<HTMLAnchorElement>;
  /** Extra attributes for the back control (focus hooks). */
  backProps?: HTMLAttributes<HTMLElement> & Record<`data-${string}`, string | boolean | undefined>;

}

export interface SectionDetail {
  title: string;
  description?: string;
}

function isSectionDetail(value: unknown): value is SectionDetail {
  return Boolean(value) && typeof value === "object" && !isValidElement(value) && "title" in (value as object);
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
  detail,
  mobileShow,
  back,
  actions,
  variant = "page",
  backProps,
  backRef,
}: PageHeaderProps) {
  const backLabel = back?.label ?? "";
  const backTo = back && "to" in back ? back.to : "/";
  const onBack = back && "onBack" in back ? back.onBack : undefined;
  const isDetail = variant === "detail";
  const pageActions: PageAction[] = actions ?? [];
  const headerRef = useRef<HTMLElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const detailRef = useRef<HTMLSpanElement>(null);
  const actionsRef = useRef<HTMLDivElement>(null);
  const [wrapped, setWrapped] = useState(false);

  // Measure against the real clock and actions so the detail never renders
  // beneath them; wrap it under the title when it does not fit. The measuring (forced layout) runs
  // when the header's content changes or its box is resized, never merely because the page
  // re-rendered (Library, Home and Search re-render on every selection change).
  const measureRef = useRef<() => void>(() => undefined);
  const lastSignatureRef = useRef<string | null>(null);
  useLayoutEffect(() => {
    const header = headerRef.current;
    const detailEl = detailRef.current;
    if (!header || !detailEl) {
      measureRef.current = () => undefined;
      lastSignatureRef.current = null;
      return;
    }
    measureRef.current = () => {
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
    const signature = `${header.textContent ?? ""}|${pageActions.length}|${isDetail}`;
    if (lastSignatureRef.current !== signature) {
      lastSignatureRef.current = signature;
      measureRef.current();
    }
  });

  // One long-lived observer and resize listener for the life of the header.
  useLayoutEffect(() => {
    const header = headerRef.current;
    if (!header) return;
    let cancelled = false;
    const measure = () => {
      if (!cancelled) measureRef.current();
    };
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(header);
    observer?.observe(document.body);
    window.addEventListener("resize", measure);
    void document.fonts?.ready.then(measure);
    return () => {
      cancelled = true;
      observer?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);

  const hasActions = Boolean(pageActions.some((action) => action.kind === "navigation" || action.kind === "status"));
  const classes = [
    "tv-library-heading",
    "page-header",
    isDetail ? "tv-detail-heading" : "",
    hasActions ? "has-actions" : "",
    wrapped && detail ? "is-detail-wrapped" : "",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <>
    <header ref={headerRef} className={classes} data-mobile-show={mobileShow}>
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
      <div className="page-header-title-block">
        <h1 ref={titleRef}>{title}</h1>
        {detail ? (
          <span
            ref={detailRef}
            className={`page-header-detail${isDetail ? " tv-detail-heading-item" : ""}${isSectionDetail(detail) ? " is-section" : ""}`}
          >
            {isSectionDetail(detail) ? (
              <>
                <strong>{detail.title}</strong>
                {detail.description ? <small>{detail.description}</small> : null}
              </>
            ) : isDetail ? (
              <strong>{detail as ReactNode}</strong>
            ) : (
              (detail as ReactNode)
            )}
          </span>
        ) : null}
      </div>
      <PageHeaderActions actions={pageActions} actionsRef={actionsRef} />
    </header>
    <PageActionStack actions={pageActions} />
    </>
  );
}
