import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Button } from "../ui";

interface Props {
  /** Current anchor day (`YYYY-MM-DD`). */
  value: string;
  /** Visible label of the current period, e.g. "October 2026". */
  label: string;
  locale: string;
  /** Unused by the picker itself; keeps callers explicit about which view the label describes. */
  view?: string;
  dialogLabel: string;
  monthLabel: string;
  yearLabel: string;
  onChange: (day: string) => void;
  /** Years offered either side of the current one. */
  yearSpan?: number;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * Selectable period label with a quick month/year jump: two scrollable lists
 * (months, years) that work with a mouse wheel, arrow keys and TV D-pad focus.
 * Choosing a month applies the jump (keeping the chosen year) and closes the panel.
 */
export function PeriodPicker({ value, label, locale, dialogLabel, monthLabel, yearLabel, onChange, yearSpan = 15 }: Props) {
  const [open, setOpen] = useState(false);
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const [draftYear, setDraftYear] = useState(year);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogId = useId();

  const months = useMemo(
    () =>
      Array.from({ length: 12 }, (_, i) =>
        new Intl.DateTimeFormat(locale, { month: "long", timeZone: "UTC" }).format(new Date(Date.UTC(2026, i, 1)))
      ),
    [locale]
  );
  const years = useMemo(
    () => Array.from({ length: yearSpan * 2 + 1 }, (_, i) => year - yearSpan + i),
    [year, yearSpan]
  );

  useEffect(() => {
    if (!open) return;
    setDraftYear(year);
    const root = rootRef.current;
    root?.querySelector<HTMLElement>("[aria-selected='true']")?.focus({ preventScroll: true });
    root?.querySelectorAll<HTMLElement>("[aria-selected='true']").forEach((el) => el.scrollIntoView({ block: "center" }));
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" || event.key === "BrowserBack" || event.key === "GoBack") {
        event.preventDefault();
        event.stopPropagation();
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    const onPointer = (event: MouseEvent) => {
      if (root && !root.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("keydown", onKey, true);
    document.addEventListener("mousedown", onPointer);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      document.removeEventListener("mousedown", onPointer);
    };
  }, [open, year]);

  function moveFocus(event: React.KeyboardEvent<HTMLElement>) {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const list = event.currentTarget.parentElement?.parentElement;
    const options = [...(list?.querySelectorAll<HTMLElement>("[role='option']") ?? [])];
    const index = options.indexOf(event.currentTarget);
    const next = options[index + (event.key === "ArrowDown" ? 1 : -1)];
    if (next) {
      event.preventDefault();
      next.focus();
    }
  }

  return (
    <div className="period-picker" ref={rootRef}>
      <Button
        ref={triggerRef}
        variant="ghost"
        className="period-picker-trigger"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={dialogId}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="calendar-range" aria-live="polite">
          {label}
        </span>
        <span aria-hidden="true">▾</span>
      </Button>
      {open ? (
        <div id={dialogId} className="period-picker-panel" role="dialog" aria-label={dialogLabel}>
          <ul role="listbox" aria-label={monthLabel} className="period-picker-list">
            {months.map((name, i) => (
              <li key={name} role="presentation">
                <button
                  type="button"
                  role="option"
                  aria-selected={draftYear === year && i + 1 === month}
                  className="period-picker-option"
                  onKeyDown={moveFocus}
                  onClick={() => {
                    onChange(`${String(draftYear).padStart(4, "0")}-${pad(i + 1)}-01`);
                    setOpen(false);
                    triggerRef.current?.focus();
                  }}
                >
                  {name}
                </button>
              </li>
            ))}
          </ul>
          <ul role="listbox" aria-label={yearLabel} className="period-picker-list">
            {years.map((y) => (
              <li key={y} role="presentation">
                <button
                  type="button"
                  role="option"
                  aria-selected={y === draftYear}
                  className="period-picker-option"
                  onKeyDown={moveFocus}
                  onClick={() => setDraftYear(y)}
                >
                  {y}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
