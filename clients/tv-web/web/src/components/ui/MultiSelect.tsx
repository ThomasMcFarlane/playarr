import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { isBackKey } from "../../lib/backKey";
import { smoothScrollIntoView } from "../../lib/smoothScroll";
import { useScrollEdges } from "../../lib/useScrollEdges";

export interface MultiSelectOption {
  value: string;
  label: string;
  /** Secondary text after the label (for example a count). */
  hint?: string;
}

export interface MultiSelectLabels {
  /** The field when nothing is selected ("Any language"). */
  none: string;
  /** The field's open button when something is selected ("Add language"). */
  add: string;
  /** Accessible name of a token's remove button. */
  remove: (label: string) => string;
  /** Live announcement after every change: how many are selected and how many options are listed. */
  announce: (selected: number, total: number) => string;
}

/** A pause longer than this starts a new letter-jump prefix. */
const JUMP_RESET_MS = 700;

/**
 * The shared multi-select input, built for a remote: a field showing the chosen values as compact removable tokens
 * (or the "none" label) that opens a plain checkbox list. There is no text input and no on-screen keyboard. Focus
 * stays on the list (`aria-activedescendant`): Up, Down, Home and End move, Enter, OK or Space toggles, Back or
 * Escape closes the list and returns focus to the field, and typing letters on a physical keyboard jumps to the
 * next label with that prefix. The list scrolls (focus is kept in view, shared edge fades). ARIA: a `listbox` with
 * `aria-multiselectable`, each option `aria-selected`. Chosen values are listed first.
 */
export function MultiSelect({
  options,
  selected,
  onChange,
  ariaLabel,
  labels,
}: {
  options: ReadonlyArray<MultiSelectOption>;
  selected: ReadonlyArray<string>;
  onChange: (next: string[]) => void;
  ariaLabel: string;
  labels: MultiSelectLabels;
}) {
  const id = useId();
  const listId = `${id}-list`;
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  // Order is fixed when the list opens, so ticking a value does not make it jump under the cursor.
  const [order, setOrder] = useState<string[]>([]);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const typed = useRef({ text: "", at: 0 });
  useScrollEdges(listRef, "vertical", open ? options.length + 1 : 0);

  const byValue = useMemo(() => new Map(options.map((option) => [option.value, option])), [options]);
  const chosen = selected.filter((value) => byValue.has(value));
  const ordered = useMemo(() => {
    const rank = new Map(order.map((value, index) => [value, index]));
    return [...options].sort((a, b) => (rank.get(a.value) ?? 1e9) - (rank.get(b.value) ?? 1e9));
  }, [options, order]);
  const activeOption = ordered[Math.min(active, ordered.length - 1)];

  useEffect(() => {
    if (open) listRef.current?.focus({ preventScroll: true });
  }, [open]);
  useEffect(() => {
    if (!open || !activeOption) return;
    const node = rootRef.current?.querySelector<HTMLElement>(`[data-option="${CSS.escape(activeOption.value)}"]`);
    if (node) smoothScrollIntoView(node);
  }, [open, activeOption?.value]);

  function openList() {
    setOrder([...selected, ...options.map((option) => option.value).filter((value) => !selected.includes(value))]);
    setActive(0);
    setOpen(true);
  }

  function closeList(refocus: boolean) {
    setOpen(false);
    if (refocus) window.requestAnimationFrame(() => triggerRef.current?.focus());
  }

  function toggle(value: string) {
    onChange(selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value]);
  }

  function jump(char: string) {
    const now = Date.now();
    const buffer = now - typed.current.at > JUMP_RESET_MS ? char : typed.current.text + char;
    typed.current = { text: buffer, at: now };
    const needle = buffer.toLocaleLowerCase();
    const from = buffer.length === 1 ? active + 1 : active;
    const labels = ordered.map((option) => option.label.toLocaleLowerCase());
    const hit = [...labels.keys()].map((i) => (i + from) % labels.length).find((i) => labels[i]!.startsWith(needle));
    if (hit !== undefined) setActive(hit);
  }

  function onListKey(event: KeyboardEvent<HTMLDivElement>) {
    const last = ordered.length - 1;
    if (isBackKey(event.nativeEvent)) {
      event.preventDefault();
      event.stopPropagation();
      closeList(true);
      return;
    }
    switch (event.key) {
      case "ArrowDown":
        setActive((i) => Math.min(last, i + 1));
        break;
      case "ArrowUp":
        setActive((i) => Math.max(0, i - 1));
        break;
      case "Home":
        setActive(0);
        break;
      case "End":
        setActive(Math.max(0, last));
        break;
      case "Enter":
      case " ":
        if (activeOption) toggle(activeOption.value);
        break;
      case "Tab":
        closeList(false);
        return;
      default:
        if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) jump(event.key);
        else return;
    }
    event.preventDefault();
    event.stopPropagation();
  }

  return (
    <div
      ref={rootRef}
      className="ui-multiselect"
      data-open={open ? "" : undefined}
      onBlur={(event) => {
        if (open && !event.currentTarget.contains(event.relatedTarget as Node | null)) closeList(false);
      }}
    >
      <div className="ui-multiselect-field" role="group" aria-label={ariaLabel}>
        {chosen.map((value) => {
          const label = byValue.get(value)!.label;
          return (
            <button
              key={value}
              type="button"
              className="ui-multiselect-token"
              aria-label={labels.remove(label)}
              onClick={() => {
                toggle(value);
                triggerRef.current?.focus();
              }}
            >
              <span>{label}</span>
              <span aria-hidden="true">×</span>
            </button>
          );
        })}
        <button
          ref={triggerRef}
          type="button"
          className="ui-multiselect-trigger"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          onClick={() => (open ? closeList(true) : openList())}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown" && !open) {
              event.preventDefault();
              event.stopPropagation();
              openList();
            }
          }}
        >
          <span>{chosen.length === 0 ? labels.none : labels.add}</span>
          <span className="ui-multiselect-chevron" aria-hidden="true">
            ⌄
          </span>
        </button>
      </div>

      {open ? (
        <div
          ref={listRef}
          id={listId}
          role="listbox"
          tabIndex={-1}
          aria-multiselectable="true"
          aria-label={ariaLabel}
          aria-activedescendant={activeOption ? `${id}-o-${activeOption.value}` : undefined}
          className="ui-multiselect-list"
          data-nested-back=""
          onKeyDown={onListKey}
        >
          {ordered.map((option) => {
            const on = selected.includes(option.value);
            return (
              <div
                key={option.value}
                id={`${id}-o-${option.value}`}
                data-option={option.value}
                role="option"
                aria-selected={on}
                className={`ui-multiselect-option${on ? " is-selected" : ""}${activeOption === option ? " is-active" : ""}`}
                // Keep focus on the list when pointing at an option.
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => toggle(option.value)}
              >
                <span className="ui-multiselect-box" aria-hidden="true">
                  {on ? "✓" : ""}
                </span>
                <span className="ui-multiselect-label">{option.label}</span>
                {option.hint ? <span className="ui-multiselect-hint">{option.hint}</span> : null}
              </div>
            );
          })}
        </div>
      ) : null}
      <p className="visually-hidden" role="status" aria-live="polite">
        {open ? labels.announce(chosen.length, ordered.length) : ""}
      </p>
    </div>
  );
}
