import { useRef, type KeyboardEvent, type ReactNode } from "react";

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  /** Optional glyph shown above the label. Decorative: the label names the segment. */
  icon?: ReactNode;
}

/**
 * The one segmented control for mutually exclusive choices in a panel: ONE row of equal segments (view mode, size ...).
 * Pressed state is `aria-pressed`; Left and Right move focus between segments, Up and Down are left alone so focus
 * leaves the row. Styling is the shared `.tv-filter-choice-grid` / `.tv-segmented` rules.
 */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  className,
}: {
  options: ReadonlyArray<SegmentedOption<T>>;
  value: T;
  onChange: (next: T) => void;
  ariaLabel: string;
  className?: string;
}) {
  const rowRef = useRef<HTMLDivElement>(null);

  function move(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    const buttons = [...(rowRef.current?.querySelectorAll<HTMLButtonElement>("button") ?? [])];
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (index < 0) return;
    const next = buttons[index + (event.key === "ArrowRight" ? 1 : -1)];
    // At either end focus stays put; it never wraps and never leaves the row sideways.
    event.preventDefault();
    event.stopPropagation();
    next?.focus();
  }

  return (
    <div
      ref={rowRef}
      className={`tv-filter-choice-grid tv-segmented${className ? ` ${className}` : ""}`}
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
      role="group"
      aria-label={ariaLabel}
      onKeyDown={move}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={value === option.value ? "is-active" : ""}
          onClick={() => onChange(option.value)}
          aria-pressed={value === option.value}
        >
          {option.icon}
          <strong>{option.label}</strong>
        </button>
      ))}
    </div>
  );
}
