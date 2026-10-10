import { useLayoutEffect, useRef } from "react";
import type { HTMLAttributes, ReactNode, Ref } from "react";
import { Button, ButtonLink } from "../ui";
import { PageActionStack, PageHeaderActions, type PageAction } from "./PageActions";
import type { ActionIcon } from "./icons";

type BackProps = { label: string } & ({ to: string } | { onBack: () => void });

export interface PageHeaderProps {
  /** Large page title (`<h1>`). */
  title: ReactNode;
  /**
   * The page subtitle (counts, section name, item title). Every page renders it in the one small media-page subtitle
   * style (`.page-subtitle`, owner rule 2026-10-10); there is no other subtitle size or weight.
   */
  detail?: ReactNode;
  /** Phones show either the page title or the detail, never both (Settings: the list shows the title, a section the detail). */
  mobileShow?: "title" | "detail";
  /** Back control: where it goes, and its accessible label. Home is the default destination. */
  back?: BackProps;
  /**
   * The page's actions, in any order. The navigation group and status text draw in the header row; panel, link and Filters
   * pills draw in the shell action column, Filters last (owner ruling 2026-10-08, Q1b).
   */
  actions?: PageAction[];
  /** `detail` is the detail-page variant (media pages): it only changes how far the header reaches, never the subtitle style. */
  variant?: "page" | "detail";
  /** Ref to the back control (focus management). */
  backRef?: Ref<HTMLAnchorElement>;
  /** Extra attributes for the back control (focus hooks). */
  backProps?: HTMLAttributes<HTMLElement> & Record<`data-${string}`, string | boolean | undefined>;

}

/**
 * The one canonical page header: back button at the top left, large title, an
 * optional divider + breadcrumb/detail, and right-aligned page actions
 * (Filters). Every routed page renders its heading through this component;
 * `pageShell.test.ts` enforces that, so pages cannot drift.
 */
// Marks the app shell while at least one page header is mounted, so the stylesheet can hide the clock beside a
// header on tablet widths without the `:has()` selector (unsupported before Chrome 105: older webOS and Tizen).
// A counter keeps the mark correct while two headers overlap during a page transition.
let mountedHeaders = 0;
function markShellPageHeader(delta: 1 | -1): void {
  mountedHeaders += delta;
  const shell = document.querySelector<HTMLElement>(".app-shell");
  if (!shell) return;
  if (mountedHeaders > 0) shell.setAttribute("data-page-header", "");
  else shell.removeAttribute("data-page-header");
}

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
  useLayoutEffect(() => {
    markShellPageHeader(1);
    return () => markShellPageHeader(-1);
  }, []);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const actionsRef = useRef<HTMLDivElement>(null);

  // Reserve the clock's column: the title stops at the shell clock (or the header's own actions) at every width, so it
  // can never run under it. Independent of the detail, which may be absent.
  useLayoutEffect(() => {
    const header = headerRef.current;
    const title = titleRef.current;
    if (!header || !title) return;
    const apply = () => {
      const clock = document.querySelector<HTMLElement>(".app-clock");
      const clockLeft = clock && getComputedStyle(clock).display !== "none" ? clock.getBoundingClientRect().left : Infinity;
      const left = title.getBoundingClientRect().left;
      const room = clockLeft - left - 16;
      if (Number.isFinite(room) && room > 0) header.style.setProperty("--page-title-max", `${Math.floor(room)}px`);
      else header.style.removeProperty("--page-title-max");
    };
    apply();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(apply);
    observer?.observe(header);
    observer?.observe(document.body);
    window.addEventListener("resize", apply);
    void document.fonts?.ready.then(apply);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", apply);
    };
  }, []);

  const hasActions = Boolean(pageActions.some((action) => action.kind === "navigation" || action.kind === "status"));
  const classes = [
    "tv-library-heading",
    "page-header",
    isDetail ? "tv-detail-heading" : "",
    hasActions ? "has-actions" : "",
    detail ? "has-subtitle" : "",
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
          <span className="page-header-detail page-subtitle">
            {detail}
          </span>
        ) : null}
      </div>
      <PageHeaderActions actions={pageActions} actionsRef={actionsRef} />
    </header>
    <PageActionStack actions={pageActions} />
    </>
  );
}
