import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { useLanguage } from "../lib/i18n/LanguageProvider";
import {
  LANGUAGE_NAMES,
  SUPPORTED_LANGUAGES,
  type LanguagePreference,
} from "../lib/i18n/languages";
import type { TranslationKey } from "../lib/i18n/translations";

const ICON_PROPS = {
  viewBox: "0 0 24 24",
  width: 16,
  height: 16,
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

function LanguageGlobeIcon() {
  return (
    <svg {...ICON_PROPS} className="language-dropdown-icon">
      <circle cx="12" cy="12" r="8.5" />
      <path d="M3.5 12h17M12 3.5c2.2 2.3 3.3 5.1 3.3 8.5S14.2 18.2 12 20.5M12 3.5C9.8 5.8 8.7 8.6 8.7 12s1.1 6.2 3.3 8.5" />
    </svg>
  );
}

function ChevronIcon() {
  return (
    <svg {...ICON_PROPS} width={12} height={12} className="language-dropdown-chevron">
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

function SearchGlyphIcon() {
  return (
    <svg {...ICON_PROPS} width={14} height={14}>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m15.5 15.5 4.5 4.5" />
    </svg>
  );
}

const LANGUAGE_OPTIONS: readonly LanguagePreference[] = ["system", ...SUPPORTED_LANGUAGES];

/**
 * English search aliases, so typing "Japanese" or "Thai" finds a language
 * whose displayed label is in its own script (`LANGUAGE_NAMES`'s endonyms) --
 * without this, only the native label and the two-letter code are matchable.
 */
const LANGUAGE_SEARCH_ALIASES: Record<Exclude<LanguagePreference, "system">, string> = {
  en: "english",
  th: "thai",
  ja: "japanese",
};

function optionLabel(option: LanguagePreference, t: (key: TranslationKey) => string): string {
  return option === "system" ? t("settings.language.optionSystem") : LANGUAGE_NAMES[option];
}

function optionMatchesQuery(option: LanguagePreference, query: string, label: string): boolean {
  if (label.toLowerCase().includes(query) || option.toLowerCase().includes(query)) return true;
  return option !== "system" && LANGUAGE_SEARCH_ALIASES[option].includes(query);
}

export function languageSearchHandlesKey(key: string): boolean {
  return key === "Enter" || key === "Escape";
}

/**
 * Searchable language picker used on the Signup page and Settings > Language
 * -- a trigger button (globe icon + current selection) that opens a listbox
 * with a search input, following the same open/close/keyboard-nav shape as
 * `PlayerControls.tsx`'s track menus (`onBlur` closes on focus leaving the
 * wrapper, `Escape` closes and refocuses the trigger) adapted to this app's
 * flat/editorial settings-page look rather than the player's dark glass
 * overlay.
 */
export function LanguageDropdown({
  className,
  onSelect,
}: {
  className?: string;
  onSelect?: (option: LanguagePreference) => void;
}) {
  const { preference, setPreference, t } = useLanguage();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const filteredOptions = useMemo(() => {
    const normalisedQuery = query.trim().toLowerCase();
    if (!normalisedQuery) return LANGUAGE_OPTIONS;
    return LANGUAGE_OPTIONS.filter((option) =>
      optionMatchesQuery(option, normalisedQuery, optionLabel(option, t))
    );
  }, [query, t]);

  useEffect(() => {
    setHighlightedIndex(0);
  }, [query]);

  useEffect(() => {
    if (!open) return;
    const selectedIndex = filteredOptions.indexOf(preference);
    optionRefs.current[Math.max(0, selectedIndex)]?.scrollIntoView({ block: "nearest" });
    // Only run once per open -- re-running on every filteredOptions change would
    // fight the user's own scrolling as they type.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function openDropdown() {
    setOpen(true);
    setQuery("");
    setHighlightedIndex(Math.max(0, LANGUAGE_OPTIONS.indexOf(preference)));
    window.requestAnimationFrame(() => searchInputRef.current?.focus());
  }

  function closeDropdown(refocusTrigger = true) {
    setOpen(false);
    setQuery("");
    if (refocusTrigger) window.requestAnimationFrame(() => triggerRef.current?.focus());
  }

  function selectOption(option: LanguagePreference) {
    const changed = option !== preference;
    setPreference(option);
    closeDropdown();
    if (changed) onSelect?.(option);
  }

  function handleSearchKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (!languageSearchHandlesKey(event.key)) return;
    switch (event.key) {
      case "Enter": {
        event.preventDefault();
        const option = filteredOptions[highlightedIndex];
        if (option) selectOption(option);
        break;
      }
      case "Escape":
        event.preventDefault();
        closeDropdown();
        break;
      default:
        break;
    }
  }

  return (
    <div
      className={`language-dropdown${className ? ` ${className}` : ""}`}
      onBlur={(event) => {
        if (open && !event.currentTarget.contains(event.relatedTarget as Node | null)) {
          closeDropdown(false);
        }
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        className="language-dropdown-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => (open ? closeDropdown() : openDropdown())}
      >
        <LanguageGlobeIcon />
        <span className="language-dropdown-label">{optionLabel(preference, t)}</span>
        <ChevronIcon />
      </button>

      {open && (
        <div
          className="language-dropdown-menu"
          role="listbox"
          aria-label={t("settings.language.title")}
        >
          <div className="language-dropdown-search">
            <SearchGlyphIcon />
            <input
              ref={searchInputRef}
              type="text"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={handleSearchKeyDown}
              placeholder={t("components.languageDropdown.searchPlaceholder")}
              aria-label={t("components.languageDropdown.searchPlaceholder")}
            />
          </div>

          <div
            className="language-dropdown-options"
            data-tv-scroll-container
            data-tv-scroll-axis="vertical"
            data-navigation-scroll-key="language:options"
          >
            {filteredOptions.length === 0 ? (
              <p className="language-dropdown-empty">
                {t("components.languageDropdown.noResults")}
              </p>
            ) : (
              filteredOptions.map((option, index) => {
                const selected = option === preference;
                return (
                  <button
                    key={option}
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
                    onClick={() => selectOption(option)}
                  >
                    <span>{optionLabel(option, t)}</span>
                    {selected && (
                      <span className="language-dropdown-check" aria-hidden="true">
                        ✓
                      </span>
                    )}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
