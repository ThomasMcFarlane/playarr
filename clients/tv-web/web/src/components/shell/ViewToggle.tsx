export interface ViewOption<T extends string> {
  value: T;
  label: string;
  /** Glyph from the shared view icon set (`tv-view-icon-*`): list, screen, cover, cover-flow. */
  icon: "list" | "screen" | "cover" | "cover-flow";
}

/** The "View" toggle shown in every page's Filters panel (list / cover / month / week ...). */
export function ViewToggle<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
}: {
  options: ReadonlyArray<ViewOption<T>>;
  value: T;
  onChange: (next: T) => void;
  ariaLabel: string;
}) {
  return (
    <div className="tv-filter-choice-grid tv-filter-view-options" role="group" aria-label={ariaLabel}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={value === option.value ? "is-active" : ""}
          onClick={() => onChange(option.value)}
          aria-pressed={value === option.value}
        >
          <span className={`tv-view-icon tv-view-icon-${option.icon}`} aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <strong>{option.label}</strong>
        </button>
      ))}
    </div>
  );
}
