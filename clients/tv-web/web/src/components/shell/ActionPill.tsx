import type { ReactNode, Ref } from "react";
import { Button, ButtonLink } from "../ui";
import { ActionIconGlyph, type ActionIcon } from "./icons";

export type { ActionIcon } from "./icons";

type DataAttributes = Record<`data-${string}`, string | boolean | undefined>;

export interface ActionPillProps {
  /** `tile` is the 30 September reference (icon over a small label, icon-only on phones); `icon` is round (Back, period arrows). */
  shape?: "tile" | "icon";
  icon: ActionIcon;
  /** Always the accessible name; visible under the icon on the tile shape. */
  label: string;
  /** Open or pressed (a drawer is showing). */
  active?: boolean;
  /** Badge on Filters. */
  count?: number;
  /** Which action kind this is, for the page-layout parity capture (`data-action-kind`). */
  kind?: string;
  /** Button behaviour (a drawer opener): onClick plus aria-expanded and aria-controls. */
  onClick?: () => void;
  controls?: string;
  /** Link behaviour (for example Customise Home). */
  to?: string;
  buttonRef?: Ref<HTMLButtonElement>;
  buttonProps?: DataAttributes;
  /** Legacy markers kept for the focus hooks and smoke scripts. */
  marker?: "data-filters-button" | "data-panel-button";
}

/**
 * The one header action. Renders the 30 September `.tv-filter-launcher` look (docs/design/page-layout.md, section 2.1)
 * under the `action-pill` class. Only `PageActions` renders it for pages: `pageLayoutAudit.test.ts` fails when a page
 * or component outside `components/shell` names it, and `pageLayoutCss.test.ts` fails when any stylesheet other than
 * `page-layout.css` styles it.
 */
export function ActionPill({
  shape = "tile",
  icon,
  label,
  active,
  count = 0,
  kind,
  onClick,
  controls,
  to,
  buttonRef,
  buttonProps,
  marker,
}: ActionPillProps) {
  const common = {
    "aria-label": label,
    "data-action-kind": kind,
    "data-action-icon": icon,
    ...(marker ? { [marker]: true } : {}),
    ...buttonProps,
  };
  const glyph = <ActionIconGlyph icon={icon} />;
  const body: ReactNode =
    shape === "icon" ? (
      glyph
    ) : (
      <>
        {glyph}
        <span>{label}</span>
        {count > 0 ? <b className="action-pill-count">{count}</b> : null}
      </>
    );
  const className = shape === "icon" ? "action-pill-icon" : "action-pill";
  if (to !== undefined) {
    return (
      <ButtonLink to={to} variant={shape === "icon" ? "icon" : "secondary"} active={active} className={className} {...common}>
        {body}
      </ButtonLink>
    );
  }
  return (
    <Button
      variant={shape === "icon" ? "icon" : "secondary"}
      className={className}
      active={active}
      onClick={onClick}
      aria-expanded={controls ? Boolean(active) : undefined}
      aria-controls={controls}
      ref={buttonRef}
      {...common}
    >
      {body}
    </Button>
  );
}
