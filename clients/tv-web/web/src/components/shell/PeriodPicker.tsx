import { smoothScrollIntoView } from "../../lib/smoothScroll";
import { periodPickerMove } from "../../lib/periodPickerNav";
import { isBackKey } from "../../lib/backKey";
import { createSettled } from "../../lib/settled";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { RefObject } from "react";

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
  /** The jump panel is controlled: the page opens it from its date switcher button, in the same group as Previous / Today / Next. */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The range button that opens the panel (clicks on it are not "outside"; BACK returns focus to it). */
  triggerRef: RefObject<HTMLElement | null>;
  /** The panel's id, for the button's `aria-controls`. */
  id: string;
}

/** The label is announced once it has stopped changing, so holding Next does not read out every period. */
export const RANGE_ANNOUNCE_DELAY_MS = 700;

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * Selectable period label with a quick month/year jump: two scrollable lists
 * (months, years) that work with a mouse wheel, arrow keys and TV D-pad focus.
 * Choosing a month applies the jump (keeping the chosen year) and closes the panel.
 */
export function PeriodPicker({ value, label, locale, dialogLabel, monthLabel, yearLabel, onChange, yearSpan = 15, open, onOpenChange, triggerRef, id }: Props) {
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const [draftYear, setDraftYear] = useState(year);
  const rootRef = useRef<HTMLDivElement>(null);
  // Starts as the current label so the first render is not announced.
  const [announced, setAnnounced] = useState(label);
  const settledRef = useRef<ReturnType<typeof createSettled<string>> | null>(null);
  settledRef.current ??= createSettled<string>(RANGE_ANNOUNCE_DELAY_MS, setAnnounced);
  useEffect(() => {
    const settled = settledRef.current!;
    settled.push(label);
    return settled.cancel;
  }, [label]);

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

  // The panel hangs below the date switcher button, right edges aligned, wherever the button sits.
  const [anchorPos, setAnchorPos] = useState<{ top: number; right: number } | null>(null);
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (rect) setAnchorPos({ top: Math.round(rect.bottom + 8), right: Math.max(8, Math.round(window.innerWidth - rect.right)) });
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [open, triggerRef]);

  useEffect(() => {
    if (!open) return;
    setDraftYear(year);
    const root = rootRef.current;
    root?.querySelector<HTMLElement>("[aria-selected='true']")?.focus({ preventScroll: true });
    root?.querySelectorAll<HTMLElement>("[aria-selected='true']").forEach((el) => smoothScrollIntoView(el, { block: "center", instant: true }));
    const onKey = (event: KeyboardEvent) => {
      if (isBackKey(event)) {
        event.preventDefault();
        event.stopPropagation();
        onOpenChange(false);
        triggerRef.current?.focus();
      }
    };
    const onPointer = (event: MouseEvent) => {
      const target = event.target as Node;
      if (root && !root.contains(target) && !triggerRef.current?.contains(target)) onOpenChange(false);
    };
    window.addEventListener("keydown", onKey, true);
    document.addEventListener("mousedown", onPointer);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      document.removeEventListener("mousedown", onPointer);
    };
  }, [open, year, onOpenChange, triggerRef]);

  function moveFocus(event: React.KeyboardEvent<HTMLElement>) {
    if (!event.key.startsWith("Arrow")) return;
    // A focus trap: the global spatial navigation never sees these keys.
    event.preventDefault();
    event.stopPropagation();
    const lists = [...(rootRef.current?.querySelectorAll<HTMLElement>("[role='listbox']") ?? [])].map((list) => [
      ...list.querySelectorAll<HTMLElement>("[role='option']"),
    ]);
    const list = lists.findIndex((options) => options.includes(event.currentTarget));
    if (list < 0) return;
    const move = periodPickerMove(
      event.key,
      list,
      lists[list]!.indexOf(event.currentTarget),
      lists.map((options) => options.length)
    );
    if (move) lists[move.list]?.[move.index]?.focus();
  }

  return (
    <div className="period-picker" ref={rootRef}>
      <span className="visually-hidden" role="status" aria-live="polite" aria-atomic="true">
        {announced}
      </span>
      {open ? (
        <div id={id} className="period-picker-panel" role="dialog" aria-modal="true" aria-label={dialogLabel} style={anchorPos ?? undefined}>
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
                    onOpenChange(false);
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
