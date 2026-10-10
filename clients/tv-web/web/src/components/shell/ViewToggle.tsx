import { SegmentedControl } from "../ui";

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
    <SegmentedControl
      className="tv-filter-view-options"
      ariaLabel={ariaLabel}
      value={value}
      onChange={onChange}
      options={options.map((option) => ({
        value: option.value,
        label: option.label,
        icon: (
          <span className={`tv-view-icon tv-view-icon-${option.icon}`} aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
        ),
      }))}
    />
  );
}
