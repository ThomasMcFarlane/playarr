import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { PlaylistsIcon } from "./NavIcons";

export interface SearchablePlaylistOption {
  value: string;
  label: string;
}

export function playlistSearchHandlesKey(key: string): boolean {
  return key === "Enter" || key === "Escape";
}

export function SearchablePlaylistSelect({
  ariaLabel,
  disabled = false,
  emptyLabel,
  id,
  noResultsLabel,
  onSelect,
  options,
  searchPlaceholder,
  triggerRef,
  value,
}: {
  ariaLabel: string;
  disabled?: boolean;
  emptyLabel: string;
  id?: string;
  noResultsLabel: string;
  onSelect: (value: string) => void;
  options: SearchablePlaylistOption[];
  searchPlaceholder: string;
  triggerRef?: (element: HTMLButtonElement | null) => void;
  value: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const internalTriggerRef = useRef<HTMLButtonElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const selectedLabel =
    options.find((option) => option.value === value)?.label ?? emptyLabel;
  const filteredOptions = useMemo(() => {
    const normalisedQuery = query.trim().toLocaleLowerCase();
    if (!normalisedQuery) return options;
    return options.filter((option) =>
      option.label.toLocaleLowerCase().includes(normalisedQuery)
    );
  }, [options, query]);

  useEffect(() => setHighlightedIndex(0), [query]);

  function assignTrigger(element: HTMLButtonElement | null) {
    internalTriggerRef.current = element;
    triggerRef?.(element);
  }

  function openDropdown() {
    if (disabled) return;
    setOpen(true);
    setQuery("");
    setHighlightedIndex(
      Math.max(0, options.findIndex((option) => option.value === value))
    );
    window.requestAnimationFrame(() => searchInputRef.current?.focus());
  }

  function closeDropdown(refocusTrigger = true) {
    setOpen(false);
    setQuery("");
    if (refocusTrigger) {
      window.requestAnimationFrame(() => internalTriggerRef.current?.focus());
    }
  }

  function selectOption(nextValue: string) {
    onSelect(nextValue);
    closeDropdown();
  }

  return (
    <div
      className="language-dropdown playlist-parent-dropdown"
      onBlur={(event) => {
        if (
          open &&
          !event.currentTarget.contains(event.relatedTarget as Node | null)
        ) {
          closeDropdown(false);
        }
      }}
    >
      <button
        ref={assignTrigger}
        id={id}
        type="button"
        className="language-dropdown-trigger"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => (open ? closeDropdown() : openDropdown())}
      >
        <PlaylistsIcon className="language-dropdown-icon" />
        <span className="language-dropdown-label">{selectedLabel}</span>
        <span className="playlist-parent-dropdown-chevron" aria-hidden="true">
          ⌄
        </span>
      </button>

      {open ? (
        <div
          className="language-dropdown-menu"
          role="listbox"
          aria-label={ariaLabel}
        >
          <div className="language-dropdown-search">
            <span aria-hidden="true">⌕</span>
            <input
              ref={searchInputRef}
              type="text"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (!playlistSearchHandlesKey(event.key)) return;
                if (event.key === "Escape") {
                  event.preventDefault();
                  event.stopPropagation();
                  closeDropdown();
                  return;
                }
                event.preventDefault();
                event.stopPropagation();
                const option = filteredOptions[highlightedIndex];
                if (option) selectOption(option.value);
                else if (!query.trim()) selectOption("");
              }}
              placeholder={searchPlaceholder}
              aria-label={searchPlaceholder}
            />
          </div>
          <div
            className="language-dropdown-options"
            data-tv-scroll-container
            data-tv-scroll-axis="vertical"
            data-navigation-scroll-key="playlist-parent:options"
          >
            {!query.trim() ? (
              <button
                type="button"
                role="option"
                aria-selected={!value}
                className={`language-dropdown-option${
                  !value ? " is-selected" : ""
                }`}
                onClick={() => selectOption("")}
              >
                <span>{emptyLabel}</span>
                {!value ? (
                  <span className="language-dropdown-check" aria-hidden="true">
                    ✓
                  </span>
                ) : null}
              </button>
            ) : null}
            {filteredOptions.length ? (
              filteredOptions.map((option, index) => {
                const selected = option.value === value;
                return (
                  <button
                    key={option.value}
                    ref={(element) => {
                      optionRefs.current[index] = element;
                    }}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    className={`language-dropdown-option${
                      highlightedIndex === index ? " is-highlighted" : ""
                    }${selected ? " is-selected" : ""}`}
                    onMouseEnter={() => setHighlightedIndex(index)}
                    onFocus={() => setHighlightedIndex(index)}
                    onClick={() => selectOption(option.value)}
                  >
                    <span>{option.label}</span>
                    {selected ? (
                      <span className="language-dropdown-check" aria-hidden="true">
                        ✓
                      </span>
                    ) : null}
                  </button>
                );
              })
            ) : query.trim() ? (
              <p className="language-dropdown-empty">{noResultsLabel}</p>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
