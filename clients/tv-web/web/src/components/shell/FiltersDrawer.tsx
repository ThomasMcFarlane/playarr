import { Button } from "../ui";
import type { ReactNode, Ref } from "react";

/** Header action that opens the page's {@link FiltersDrawer}. */
export function FiltersButton({
  label,
  open,
  onToggle,
  controls,
  activeCount = 0,
  buttonRef,
  buttonProps,
}: {
  buttonRef?: Ref<HTMLButtonElement>;
  /** Page-specific data attributes (focus keys, edge targets). */
  buttonProps?: Record<`data-${string}`, string | boolean | undefined>;
  label: string;
  open: boolean;
  onToggle: () => void;
  /** Id of the drawer this button controls. */
  controls: string;
  /** Number of active filters, shown as a badge. */
  activeCount?: number;
}) {
  return (
    <Button
      variant="secondary"
      className="page-filters-button"
      active={open}
      onClick={onToggle}
      aria-expanded={open}
      aria-controls={controls}
      data-filters-button
      ref={buttonRef}
      {...buttonProps}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 6h16M7 12h10m-7 6h4" />
        <circle cx="8" cy="6" r="1.5" />
        <circle cx="15" cy="12" r="1.5" />
        <circle cx="12" cy="18" r="1.5" />
      </svg>
      <span>{label}</span>
      {activeCount > 0 ? <b className="page-filters-count">{activeCount}</b> : null}
    </Button>
  );
}

/** Secondary header action stacked directly below Filters (for example Calendar subscription); same style and slot family. */
export function PanelButton({
  label,
  icon,
  open,
  onToggle,
  controls,
  buttonRef,
  buttonProps,
}: {
  buttonRef?: Ref<HTMLButtonElement>;
  buttonProps?: Record<`data-${string}`, string | boolean | undefined>;
  label: string;
  icon: ReactNode;
  open: boolean;
  onToggle: () => void;
  controls: string;
}) {
  return (
    <Button
      variant="secondary"
      className="page-filters-button"
      active={open}
      onClick={onToggle}
      aria-expanded={open}
      aria-controls={controls}
      data-panel-button
      ref={buttonRef}
      {...buttonProps}
    >
      {icon}
      <span>{label}</span>
    </Button>
  );
}

/** The shared Drawer, used for page filters. */
export { Drawer as FiltersDrawer } from "./Drawer";

/** One titled section inside a {@link FiltersDrawer}. */
export function FilterSection({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section>
      {title ? <h3>{title}</h3> : null}
      {children}
    </section>
  );
}

/** Shared multi-select: a set of toggle chips (`aria-pressed`) for a filter section. */
export function MultiSelect<T extends string>({
  options,
  selected,
  onChange,
  ariaLabel,
}: {
  options: ReadonlyArray<{ value: T; label: string }>;
  selected: ReadonlySet<T>;
  onChange: (next: Set<T>) => void;
  ariaLabel: string;
}) {
  return (
    <div className="tv-filter-choice-grid" role="group" aria-label={ariaLabel}>
      {options.map((option) => {
        const on = selected.has(option.value);
        return (
          <button
            key={option.value}
            type="button"
            className={on ? "is-active" : ""}
            aria-pressed={on}
            onClick={() => {
              const next = new Set(selected);
              if (on) next.delete(option.value);
              else next.add(option.value);
              onChange(next);
            }}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/** Shared calendar-range control: inclusive from/to days (`YYYY-MM-DD`), either may be empty. */
export function DateRangeField({
  from,
  to,
  fromLabel,
  toLabel,
  clearLabel,
  onChange,
}: {
  from: string | null;
  to: string | null;
  fromLabel: string;
  toLabel: string;
  clearLabel: string;
  onChange: (range: { from: string | null; to: string | null }) => void;
}) {
  return (
    <div className="filters-date-range">
      <label>
        <span>{fromLabel}</span>
        <input
          type="date"
          value={from ?? ""}
          max={to ?? undefined}
          onChange={(event) => onChange({ from: event.target.value || null, to })}
        />
      </label>
      <label>
        <span>{toLabel}</span>
        <input
          type="date"
          value={to ?? ""}
          min={from ?? undefined}
          onChange={(event) => onChange({ from, to: event.target.value || null })}
        />
      </label>
      {from || to ? (
        <button type="button" className="filters-date-clear" onClick={() => onChange({ from: null, to: null })}>
          {clearLabel}
        </button>
      ) : null}
    </div>
  );
}
