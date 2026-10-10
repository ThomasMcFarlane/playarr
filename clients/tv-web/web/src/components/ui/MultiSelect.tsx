import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { isBackKey } from "../../lib/backKey";
import { smoothScrollIntoView } from "../../lib/smoothScroll";

export interface MultiSelectOption {
  value: string;
  label: string;
  /** Secondary text after the label (for example a count). Not searched. */
  hint?: string;
}

export interface MultiSelectLabels {
  /** The field when nothing is selected ("Any language"). */
  none: string;
  /** The field's open button when something is selected ("Add language"). */
  add: string;
  /** Accessible name of the search box and the list. */
  search: string;
  /** Shown when the search matches nothing. */
  noMatches: string;
  /** Accessible name of a token's remove button. */
  remove: (label: string) => string;
  /** Live announcement after every change: how many are selected and how many options are listed. */
  announce: (selected: number, shown: number) => string;
}

/**
 * The shared multi-select input: a field showing the chosen values as compact removable tokens (or the "none"
 * label); activating it opens a searchable checkbox list. Focus stays in the search box and the options are
 * announced through `aria-activedescendant`, so typing filters, Up and Down move, Enter (or OK) toggles, and Back or
 * Escape closes the list and returns focus to the field. ARIA: the search box is the combobox, the list is a
 * `listbox` with `aria-multiselectable`, each option `aria-selected`. Chosen values are listed first.
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
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  // Order is fixed when the list opens, so ticking a value does not make it jump under the cursor.
  const [order, setOrder] = useState<string[]>([]);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const byValue = useMemo(() => new Map(options.map((option) => [option.value, option])), [options]);
  const chosen = selected.filter((value) => byValue.has(value));
  const ordered = useMemo(() => {
    const rank = new Map(order.map((value, index) => [value, index]));
    return [...options].sort((a, b) => (rank.get(a.value) ?? 1e9) - (rank.get(b.value) ?? 1e9));
  }, [options, order]);
  const shown = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return needle ? ordered.filter((option) => option.label.toLocaleLowerCase().includes(needle)) : ordered;
  }, [ordered, query]);
  const activeOption = shown[Math.min(active, shown.length - 1)];

  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    if (open) inputRef.current?.focus({ preventScroll: true });
  }, [open]);
  useEffect(() => {
    if (!open || !activeOption) return;
    const node = rootRef.current?.querySelector<HTMLElement>(`[data-option="${CSS.escape(activeOption.value)}"]`);
    if (node) smoothScrollIntoView(node);
  }, [open, activeOption?.value]);

  function openList() {
    setOrder([...selected, ...options.map((option) => option.value).filter((value) => !selected.includes(value))]);
    setQuery("");
    setActive(0);
    setOpen(true);
  }

  function closeList(refocus: boolean) {
    setOpen(false);
    setQuery("");
    if (refocus) window.requestAnimationFrame(() => triggerRef.current?.focus());
  }

  function toggle(value: string) {
    onChange(selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value]);
  }

  function onSearchKey(event: KeyboardEvent<HTMLInputElement>) {
    const last = shown.length - 1;
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
        if (activeOption) toggle(activeOption.value);
        break;
      default:
        // Left and Right edit the search text; other keys type.
        return;
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
        <div className="ui-multiselect-popup" data-nested-back="">
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            className="ui-multiselect-search"
            aria-label={labels.search}
            aria-expanded="true"
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={activeOption ? `${id}-o-${activeOption.value}` : undefined}
            placeholder={labels.search}
            autoComplete="off"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onSearchKey}
          />
          <div id={listId} role="listbox" aria-multiselectable="true" aria-label={ariaLabel} className="ui-multiselect-list">
            {shown.map((option) => {
              const on = selected.includes(option.value);
              return (
                <div
                  key={option.value}
                  id={`${id}-o-${option.value}`}
                  data-option={option.value}
                  role="option"
                  aria-selected={on}
                  className={`ui-multiselect-option${on ? " is-selected" : ""}${activeOption === option ? " is-active" : ""}`}
                  // Keep focus in the search box when pointing at an option.
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
            {shown.length === 0 ? <p className="ui-multiselect-empty">{labels.noMatches}</p> : null}
          </div>
        </div>
      ) : null}
      <p className="visually-hidden" role="status" aria-live="polite">
        {open ? labels.announce(chosen.length, shown.length) : ""}
      </p>
    </div>
  );
}
