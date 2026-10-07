import { ActionPill } from "./ActionPill";
import type { ActionIcon } from "./icons";
import type { ReactNode, Ref } from "react";

/** @deprecated Use a `filters` action on the page header. An alias of {@link ActionPill} for one PR. */
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
  buttonProps?: Record<`data-${string}`, string | boolean | undefined>;
  label: string;
  open: boolean;
  onToggle: () => void;
  controls: string;
  activeCount?: number;
}) {
  return (
    <ActionPill
      kind="filters"
      marker="data-filters-button"
      icon="filters"
      label={label}
      active={open}
      count={activeCount}
      onClick={onToggle}
      controls={controls}
      buttonRef={buttonRef}
      buttonProps={buttonProps}
    />
  );
}

/** @deprecated Use a `panel` action on the page header. An alias of {@link ActionPill} for one PR. */
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
  icon: ActionIcon;
  open: boolean;
  onToggle: () => void;
  controls: string;
}) {
  return (
    <ActionPill
      kind="panel"
      marker="data-panel-button"
      icon={icon}
      label={label}
      active={open}
      onClick={onToggle}
      controls={controls}
      buttonRef={buttonRef}
      buttonProps={buttonProps}
    />
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
