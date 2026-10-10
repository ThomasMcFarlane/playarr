import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { isBackKey } from "../../lib/backKey";
import { smoothScrollIntoView } from "../../lib/smoothScroll";

export interface SelectOption {
  value: string;
  label: string;
  /** Secondary text shown after the label (for example a size). */
  hint?: string;
}

/**
 * The shared single-select input: a field showing the chosen option that opens a list. Focus moves into the list
 * (`aria-activedescendant`), so Up, Down, Home and End move, Enter (or OK) chooses and closes, Back or Escape closes
 * without changing anything. Focus returns to the field. Use it for any "pick one from many" choice; for two to four
 * short choices use `SegmentedControl`, for several values use `MultiSelect`.
 */
export function Select({
  options,
  value,
  onChange,
  ariaLabel,
  disabled = false,
}: {
  options: ReadonlyArray<SelectOption>;
  value: string;
  onChange: (next: string) => void;
  ariaLabel: string;
  disabled?: boolean;
}) {
  const id = useId();
  const listId = `${id}-list`;
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const chosen = options.find((option) => option.value === value);

  useEffect(() => {
    if (!open) return;
    listRef.current?.focus({ preventScroll: true });
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const node = rootRef.current?.querySelector<HTMLElement>(`[id="${CSS.escape(`${id}-o-${options[active]?.value ?? ""}`)}"]`);
    if (node) smoothScrollIntoView(node);
  }, [open, active, id, options]);

  function openList() {
    if (disabled) return;
    setActive(Math.max(0, options.findIndex((option) => option.value === value)));
    setOpen(true);
  }

  function closeList() {
    setOpen(false);
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  }

  function choose(next: string) {
    onChange(next);
    closeList();
  }

  function onListKey(event: KeyboardEvent<HTMLDivElement>) {
    const last = options.length - 1;
    if (isBackKey(event.nativeEvent)) {
      event.preventDefault();
      event.stopPropagation();
      closeList();
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
        if (options[active]) choose(options[active].value);
        break;
      case "Tab":
        setOpen(false);
        return;
      default:
        return;
    }
    event.preventDefault();
    event.stopPropagation();
  }

  return (
    <div
      ref={rootRef}
      className="ui-select"
      data-open={open ? "" : undefined}
      onBlur={(event) => {
        if (open && !event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        className="ui-select-trigger"
        aria-label={`${ariaLabel}: ${chosen?.label ?? ""}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        disabled={disabled}
        onClick={() => (open ? closeList() : openList())}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" && !open) {
            event.preventDefault();
            event.stopPropagation();
            openList();
          }
        }}
      >
        <span className="ui-select-value">{chosen?.label ?? ""}</span>
        {chosen?.hint ? <span className="ui-select-hint">{chosen.hint}</span> : null}
        <span className="ui-select-chevron" aria-hidden="true">
          ⌄
        </span>
      </button>
      {open ? (
        <div
          ref={listRef}
          id={listId}
          role="listbox"
          tabIndex={-1}
          aria-label={ariaLabel}
          aria-activedescendant={options[active] ? `${id}-o-${options[active].value}` : undefined}
          className="ui-select-list"
          data-nested-back=""
          onKeyDown={onListKey}
        >
          {options.map((option, index) => (
            <div
              key={option.value}
              id={`${id}-o-${option.value}`}
              role="option"
              aria-selected={option.value === value}
              className={`ui-select-option${option.value === value ? " is-selected" : ""}${index === active ? " is-active" : ""}`}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => choose(option.value)}
            >
              <span className="ui-select-label">{option.label}</span>
              {option.hint ? <span className="ui-select-hint">{option.hint}</span> : null}
              <span className="ui-select-check" aria-hidden="true">
                {option.value === value ? "✓" : ""}
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
