import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";

const SEARCH_DEBOUNCE_MS = 250;

export interface SearchableMultiSelectOption {
  value: string;
  label: string;
  description?: string;
}

export function multiSelectSearchHandlesKey(key: string): boolean {
  return key === "Enter" || key === "Escape";
}

export function toggleMultiSelectValue(
  values: readonly string[],
  value: string
): string[] {
  return values.includes(value)
    ? values.filter((candidate) => candidate !== value)
    : [...values, value];
}

export function filterMultiSelectOptions(
  options: readonly SearchableMultiSelectOption[],
  query: string
): SearchableMultiSelectOption[] {
  const normalised = query.trim().toLocaleLowerCase();
  if (!normalised) return [...options];
  return options.filter(
    (option) =>
      option.label.toLocaleLowerCase().includes(normalised) ||
      option.description?.toLocaleLowerCase().includes(normalised) ||
      option.value.toLocaleLowerCase().includes(normalised)
  );
}

export function mergeSearchableMultiSelectOptions(
  ...groups: ReadonlyArray<readonly SearchableMultiSelectOption[]>
): SearchableMultiSelectOption[] {
  const merged = new Map<string, SearchableMultiSelectOption>();
  for (const group of groups) {
    for (const option of group) {
      if (!merged.has(option.value)) merged.set(option.value, option);
    }
  }
  return [...merged.values()];
}

export interface SearchableMultiSelectProps {
  id: string;
  label: string;
  options: SearchableMultiSelectOption[];
  values: string[];
  onChange: (values: string[]) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  disabled?: boolean;
  allowCustomValue?: boolean;
  loadOptions?: (
    query: string
  ) => Promise<SearchableMultiSelectOption[]>;
  /** Useful for static rendering, documentation, and accessibility tests. */
  openByDefault?: boolean;
}

/**
 * Searchable multi-choice field built from a labelled popover, search input,
 * and native checkboxes. It deliberately does not impersonate an ARIA
 * combobox: native checkbox semantics remain intact while the trigger exposes
 * the panel as a dialog.
 */
export function SearchableMultiSelect({
  id,
  label,
  options,
  values,
  onChange,
  placeholder = "Any",
  searchPlaceholder = "Search...",
  disabled = false,
  allowCustomValue = false,
  loadOptions,
  openByDefault = false,
}: SearchableMultiSelectProps) {
  const [open, setOpen] = useState(openByDefault);
  const [query, setQuery] = useState("");
  const [remoteOptions, setRemoteOptions] = useState<
    SearchableMultiSelectOption[]
  >([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const requestGeneration = useRef(0);

  const allOptions = useMemo(
    () =>
      mergeSearchableMultiSelectOptions(
        options,
        remoteOptions,
        values.map((value) => ({ value, label: value }))
      ),
    [options, remoteOptions, values]
  );
  const filteredOptions = useMemo(
    () => filterMultiSelectOptions(allOptions, query),
    [allOptions, query]
  );
  const selectedLabels = values.map(
    (value) =>
      allOptions.find((option) => option.value === value)?.label ?? value
  );
  const trimmedQuery = query.trim();
  const customValueAvailable =
    allowCustomValue &&
    Boolean(trimmedQuery) &&
    !allOptions.some(
      (option) =>
        option.value.toLocaleLowerCase() ===
          trimmedQuery.toLocaleLowerCase() ||
        option.label.toLocaleLowerCase() === trimmedQuery.toLocaleLowerCase()
    );

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) close(false);
    }
    function handleDocumentKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") close();
    }
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleDocumentKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleDocumentKeyDown);
    };
  }, [open]);

  useEffect(() => {
    const generation = ++requestGeneration.current;
    if (!open || !loadOptions || trimmedQuery.length < 2) {
      setLoading(false);
      setLoadError(null);
      setRemoteOptions([]);
      return () => {
        if (requestGeneration.current === generation) {
          requestGeneration.current += 1;
        }
      };
    }
    setLoading(true);
    setLoadError(null);
    const timer = window.setTimeout(() => {
      loadOptions(trimmedQuery)
        .then((loaded) => {
          if (requestGeneration.current === generation) {
            setRemoteOptions(loaded);
          }
        })
        .catch(() => {
          if (requestGeneration.current === generation) {
            setRemoteOptions([]);
            setLoadError("Could not load options.");
          }
        })
        .finally(() => {
          if (requestGeneration.current === generation) setLoading(false);
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      window.clearTimeout(timer);
      if (requestGeneration.current === generation) {
        requestGeneration.current += 1;
      }
    };
  }, [loadOptions, open, trimmedQuery]);

  function close(refocus = true) {
    requestGeneration.current += 1;
    setOpen(false);
    setQuery("");
    setRemoteOptions([]);
    setLoading(false);
    setLoadError(null);
    if (refocus) {
      window.requestAnimationFrame(() => triggerRef.current?.focus());
    }
  }

  function toggleOpen() {
    if (disabled) return;
    if (open) {
      close();
      return;
    }
    setOpen(true);
    window.requestAnimationFrame(() => searchRef.current?.focus());
  }

  function select(value: string) {
    onChange(toggleMultiSelectValue(values, value));
  }

  function addCustomValue() {
    if (!customValueAvailable) return;
    onChange([...values, trimmedQuery]);
    setQuery("");
  }

  function handleSearchKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (!multiSelectSearchHandlesKey(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.key === "Escape") {
      close();
      return;
    }
    if (customValueAvailable) {
      addCustomValue();
      return;
    }
    const first = filteredOptions[0];
    if (first) select(first.value);
  }

  const labelId = `${id}-label`;
  const panelId = `${id}-panel`;
  const optionsId = `${id}-options`;
  const summaryId = `${id}-summary`;
  const selectedSummary =
    selectedLabels.length === 0
      ? placeholder
      : selectedLabels.length <= 2
        ? selectedLabels.join(", ")
        : `${selectedLabels.slice(0, 2).join(", ")} +${
            selectedLabels.length - 2
          }`;

  return (
    <div
      className="activity-multi-select"
      ref={rootRef}
      onBlur={(event) => {
        if (
          open &&
          !event.currentTarget.contains(event.relatedTarget as Node | null)
        ) {
          close(false);
        }
      }}
    >
      <span className="form-label" id={labelId}>
        {label}
      </span>
      <button
        ref={triggerRef}
        id={id}
        type="button"
        className={`activity-multi-select-trigger${
          open ? " is-open" : ""
        }`}
        aria-labelledby={`${labelId} ${summaryId}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        disabled={disabled}
        onClick={toggleOpen}
      >
        <span
          id={summaryId}
          className={values.length ? "" : "muted"}
        >
          {selectedSummary}
        </span>
        <span className="activity-multi-select-chevron" aria-hidden="true">
          ⌄
        </span>
      </button>

      {open && (
        <div
          id={panelId}
          className="activity-multi-select-panel"
          role="dialog"
          aria-labelledby={labelId}
          aria-describedby={summaryId}
        >
          <div className="activity-multi-select-search">
            <span aria-hidden="true">⌕</span>
            <input
              ref={searchRef}
              type="search"
              value={query}
              placeholder={searchPlaceholder}
              aria-label={`Search ${label.toLocaleLowerCase()}`}
              aria-controls={optionsId}
              aria-busy={loading}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={handleSearchKeyDown}
            />
          </div>

          <div
            id={optionsId}
            className="activity-multi-select-options"
            role="group"
            aria-label={`${label} options`}
            aria-busy={loading}
            data-tv-scroll-container
            data-tv-scroll-axis="vertical"
            data-navigation-scroll-key={`activity-filter:${id}`}
          >
            {customValueAvailable && (
              <button
                type="button"
                className="activity-multi-select-custom"
                onClick={addCustomValue}
              >
                Add “{trimmedQuery}”
              </button>
            )}
            {filteredOptions.map((option) => (
              <label
                key={option.value}
                className="activity-multi-select-option checkbox-label"
              >
                <input
                  type="checkbox"
                  checked={values.includes(option.value)}
                  onChange={() => select(option.value)}
                />
                <span>
                  <strong>{option.label}</strong>
                  {option.description && <small>{option.description}</small>}
                </span>
              </label>
            ))}
            {loading && (
              <p className="activity-multi-select-message" role="status">
                Loading...
              </p>
            )}
            {!loading &&
              !loadError &&
              !customValueAvailable &&
              filteredOptions.length === 0 && (
                <p className="activity-multi-select-message">No matches</p>
              )}
            {loadError && (
              <p className="activity-multi-select-message error-text" role="alert">
                {loadError}
              </p>
            )}
          </div>

          <div className="activity-multi-select-actions">
            <span className="muted">
              {values.length} selected
            </span>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={values.length === 0}
              onClick={() => onChange([])}
            >
              Clear
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => close()}
            >
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
