import type { ReactNode, Ref } from "react";
import { Button } from "../ui";
import { ActionPill } from "./ActionPill";
import { ShellActionColumnSlot } from "./ShellActionColumn";
import type { ActionIcon } from "./icons";

type DataAttributes = Record<`data-${string}`, string | boolean | undefined>;

export interface NavigationItem {
  id: string;
  label: string;
  /** `icon` items are round arrows; `text` items are the secondary text button (Today). */
  icon?: ActionIcon;
  onSelect: () => void;
  buttonProps?: DataAttributes;
}

export type PageAction =
  | {
      kind: "navigation";
      id: string;
      label: string;
      items: NavigationItem[];
      /** The page shows the same controls in its own phone sub-row, so the header group is hidden at phone width. */
      hideOnPhone?: boolean;
    }
  | {
      kind: "panel";
      id: string;
      label: string;
      /** Accessible name when the visible label is abbreviated. */
      ariaLabel?: string;
      icon: ActionIcon;
      open: boolean;
      onToggle: () => void;
      controls: string;
      buttonRef?: Ref<HTMLButtonElement>;
      buttonProps?: DataAttributes;
    }
  | { kind: "link"; id: string; label: string; icon: ActionIcon; to: string; buttonProps?: DataAttributes }
  | {
      kind: "filters";
      label: string;
      open: boolean;
      onToggle: () => void;
      controls: string;
      activeCount?: number;
      buttonRef?: Ref<HTMLButtonElement>;
      buttonProps?: DataAttributes;
    }
  | { kind: "status"; id: string; label: string };

const ORDER: Record<PageAction["kind"], number> = { navigation: 0, panel: 1, link: 1, status: 1, filters: 2 };

/** Order is enforced here, not trusted from the caller: navigation, then panel/link/status in array order, then Filters. */
export function orderPageActions(actions: readonly PageAction[]): PageAction[] {
  const filters = actions.filter((action) => action.kind === "filters");
  if (filters.length > 1) throw new Error("A page header takes at most one Filters action");
  return actions
    .map((action, index) => ({ action, index }))
    .sort((a, b) => ORDER[a.action.kind] - ORDER[b.action.kind] || a.index - b.index)
    .map(({ action }) => action);
}

function renderAction(action: PageAction): ReactNode {
  switch (action.kind) {
    case "navigation":
      return (
        <div key={action.id} className="page-actions-navigation" role="group" aria-label={action.label} data-action-kind="navigation" data-hide-on-phone={action.hideOnPhone ? "" : undefined}>
          {action.items.map((item) =>
            item.icon ? (
              <ActionPill key={item.id} shape="icon" icon={item.icon} label={item.label} onClick={item.onSelect} buttonProps={item.buttonProps} />
            ) : (
              <Button key={item.id} variant="secondary" onClick={item.onSelect} {...item.buttonProps}>
                {item.label}
              </Button>
            )
          )}
        </div>
      );
    case "panel":
      return (
        <ActionPill
          key={action.id}
          kind="panel"
          marker="data-panel-button"
          icon={action.icon}
          label={action.label}
          ariaLabel={action.ariaLabel}
          active={action.open}
          onClick={action.onToggle}
          controls={action.controls}
          buttonRef={action.buttonRef}
          buttonProps={action.buttonProps}
        />
      );
    case "link":
      return <ActionPill key={action.id} kind="link" icon={action.icon} label={action.label} to={action.to} buttonProps={action.buttonProps} />;
    case "status":
      return (
        <span key={action.id} className="page-actions-status" role="status" data-action-kind="status">
          {action.label}
        </span>
      );
    case "filters":
      return (
        <ActionPill
          key="filters"
          kind="filters"
          marker="data-filters-button"
          icon="filters"
          label={action.label}
          active={action.open}
          count={action.activeCount}
          onClick={action.onToggle}
          controls={action.controls}
          buttonRef={action.buttonRef}
          buttonProps={action.buttonProps}
        />
      );
  }
}

const inHeaderRow = (action: PageAction) => action.kind === "navigation" || action.kind === "status";

/** The part of the actions that lives in the header row: the navigation group and status text (never pills). */
export function PageHeaderActions({
  actions,
  actionsRef,
}: {
  actions: readonly PageAction[];
  actionsRef?: Ref<HTMLDivElement>;
}) {
  const leading = orderPageActions(actions).filter(inHeaderRow);
  if (!leading.length) return null;
  return (
    <div ref={actionsRef} className="page-header-actions">
      {leading.map(renderAction)}
    </div>
  );
}

/**
 * Every side-panel and action pill (panel, link, Filters) of a page, rendered in the shell action column, stacked
 * vertically with Filters last (owner ruling 2026-10-08, Q1b). Without a shell (tests) it renders in place.
 */
export function PageActionStack({ actions }: { actions: readonly PageAction[] }) {
  const stack = orderPageActions(actions).filter((action) => !inHeaderRow(action));
  if (!stack.length) return null;
  return (
    <ShellActionColumnSlot>
      <div className="page-header-stack">{stack.map(renderAction)}</div>
    </ShellActionColumnSlot>
  );
}

/** Both parts, for a page that has no header row of its own (Home). */
export function PageActions(props: { actions: readonly PageAction[] }) {
  return (
    <>
      <PageHeaderActions actions={props.actions} />
      <PageActionStack actions={props.actions} />
    </>
  );
}
