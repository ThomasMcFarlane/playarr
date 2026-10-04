import type { KeyboardEventHandler, ReactNode, Ref } from "react";

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
    <button
      type="button"
      className={`page-filters-button${open ? " is-active" : ""}`}
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
    </button>
  );
}

/** Shared filters pane: right-hand drawer with a title, close control and filter sections. */
export function FiltersDrawer({
  id,
  open,
  title,
  kicker,
  ariaLabel,
  closeLabel,
  onClose,
  children,
  drawerRef,
  titleId,
  modal,
  onKeyDown,
}: {
  drawerRef?: Ref<HTMLElement>;
  /** Labels the drawer by its heading (dialog semantics) instead of `ariaLabel`. */
  titleId?: string;
  modal?: boolean;
  /** Replaces the default Escape-to-close handler (focus trapping). */
  onKeyDown?: KeyboardEventHandler<HTMLElement>;
  id: string;
  open: boolean;
  title: string;
  kicker?: string;
  ariaLabel: string;
  closeLabel: string;
  onClose: () => void;
  children: ReactNode;
}) {
  if (!open) return null;
  return (
    <aside
      id={id}
      ref={drawerRef}
      className="tv-filter-drawer"
      role={modal ? "dialog" : undefined}
      aria-modal={modal ? true : undefined}
      aria-label={titleId ? undefined : ariaLabel}
      aria-labelledby={titleId}
      onKeyDown={
        onKeyDown ??
        ((event) => {
          if (event.key === "Escape") {
            event.stopPropagation();
            onClose();
          }
        })
      }
    >
      <header>
        <div>
          {kicker ? <p>{kicker}</p> : null}
          <h2 id={titleId}>{title}</h2>
        </div>
        <button type="button" onClick={onClose} aria-label={closeLabel}>
          ×
        </button>
      </header>
      {children}
    </aside>
  );
}

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
