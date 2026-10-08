import type { ReactNode } from "react";

/** The shared Drawer, used for page filters. */
export { Drawer as FiltersDrawer } from "./Drawer";

/** One titled section inside a {@link FiltersDrawer}. */
export function FilterSection({
  title,
  children,
  ...rest
}: { title?: string; children: ReactNode } & Record<`data-${string}`, string | boolean | undefined>) {
  return (
    <section {...rest}>
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

/** A group of mutually exclusive filter chips (type, sort, view ...). */
export function ChoiceGroup<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
}: {
  options: ReadonlyArray<{ value: T; label: string }>;
  value: T;
  onChange: (next: T) => void;
  ariaLabel: string;
}) {
  return (
    <div className="tv-filter-choice-grid" role="group" aria-label={ariaLabel}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={value === option.value ? "is-active" : ""}
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
