import { isValidElement, useLayoutEffect, useRef, useState } from "react";
import type { HTMLAttributes, ReactNode, Ref } from "react";
import { detailFitsInline } from "../../lib/pageHeaderLayout";
import { Button, ButtonLink } from "../ui";
import { PageActionStack, PageHeaderActions, type PageAction } from "./PageActions";
import type { ActionIcon } from "./icons";

/** Legacy Filters slot, kept until the page that passes it migrates to `actions`. */
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

/** Legacy panel opener, kept until the page that passes it migrates to `actions`. */
export interface PanelSlot {
  id: string;
  label: string;
  icon: ActionIcon;
  open: boolean;
  onToggle: () => void;
  controls: string;
  buttonRef?: Ref<HTMLButtonElement>;
  buttonProps?: Record<`data-${string}`, string | boolean | undefined>;
}

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
   * The header actions, in any order: `PageActions` draws them navigation first, secondary pills next and Filters last.
   * A node is still accepted while Downloads migrates (W3).
   */
  actions?: PageAction[] | ReactNode;
  /** `detail` is the detail-page variant: the detail text is the item title, bold. */
  variant?: "page" | "detail";
  /** Ref to the back control (focus management). */
  backRef?: Ref<HTMLAnchorElement>;
  /** Extra attributes for the back control (focus hooks). */
  backProps?: HTMLAttributes<HTMLElement> & Record<`data-${string}`, string | boolean | undefined>;

  /** @deprecated Use `back`. Kept until the page that passes it migrates. */
  backLabel?: string;
  /** @deprecated Use `back`. */
  backTo?: string;
  /** @deprecated Use `back`. */
  onBack?: () => void;
  /** @deprecated Use an `actions` filters entry. */
  filters?: FiltersSlot;
  /** @deprecated Use `actions` panel entries. */
  panelButtons?: readonly PanelSlot[];
  /** @deprecated Use an `actions` navigation entry. */
  navigation?: ReactNode;
  /** @deprecated A page may not restyle the header; removed as pages migrate (W2, W6). */
  detailClassName?: string;
  /** @deprecated A page may not restyle the header; removed as pages migrate (W2, W6). */
  className?: string;
}

export interface SectionDetail {
  title: string;
  description?: string;
}

function isSectionDetail(value: unknown): value is SectionDetail {
  return Boolean(value) && typeof value === "object" && !isValidElement(value) && "title" in (value as object);
}

function isActionList(value: unknown): value is PageAction[] {
  return Array.isArray(value) && value.every((item) => item && typeof item === "object" && "kind" in item);
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
  backLabel: legacyBackLabel,
  backTo: legacyBackTo,
  onBack: legacyOnBack,
  filters,
  panelButtons,
  navigation,
  detailClassName,
  className,
}: PageHeaderProps) {
  const backLabel = back?.label ?? legacyBackLabel ?? "";
  const backTo = back && "to" in back ? back.to : (legacyBackTo ?? "/");
  const onBack = back && "onBack" in back ? back.onBack : legacyOnBack;
  const isDetail = variant === "detail";
  const pageActions: PageAction[] = [
    ...(isActionList(actions) ? actions : []),
    ...(panelButtons ?? []).map((panel): PageAction => ({ kind: "panel", ...panel })),
    ...(filters ? [{ kind: "filters", ...filters } as PageAction] : []),
  ];
  const extraNode = isActionList(actions) ? null : (actions as ReactNode);
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

  const hasActions = Boolean(extraNode || navigation || pageActions.some((action) => action.kind === "navigation" || action.kind === "status"));
  const classes = [
    "tv-library-heading",
    "page-header",
    isDetail ? "tv-detail-heading" : "",
    hasActions ? "has-actions" : "",
    wrapped && detail ? "is-detail-wrapped" : "",
    className ?? "",
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
            className={`page-header-detail${isDetail ? " tv-detail-heading-item" : ""}${isSectionDetail(detail) ? " is-section" : ""}${detailClassName ? ` ${detailClassName}` : ""}`}
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
      <PageHeaderActions actions={pageActions} actionsRef={actionsRef} legacyNavigation={navigation} legacyExtra={extraNode} />
    </header>
    <PageActionStack actions={pageActions} />
    </>
  );
}
