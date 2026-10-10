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
