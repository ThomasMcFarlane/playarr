import {
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { useLanguage } from "../lib/i18n/LanguageProvider";
import type { TranslationKey } from "../lib/i18n/translations";
import { useTheme, type ThemePreference } from "../lib/theme";

export const THEME_OPTIONS: readonly ThemePreference[] = [
  "system",
  "light",
  "dark",
];
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

const THEME_LABEL_KEYS: Record<ThemePreference, TranslationKey> = {
  system: "components.themeDropdown.optionSystem",
  light: "components.themeDropdown.optionLight",
  dark: "components.themeDropdown.optionDark",
};

function ThemeIcon() {
  return (
    <svg {...ICON_PROPS} className="language-dropdown-icon">
      <path d="M12 3v2M12 19v2M3 12h2M19 12h2" />
      <circle cx="12" cy="12" r="4" />
      <path d="m5.64 5.64 1.42 1.42M16.94 16.94l1.42 1.42M18.36 5.64l-1.42 1.42M7.06 16.94l-1.42 1.42" />
    </svg>
  );
}

function ChevronIcon() {
  return (
    <svg
      {...ICON_PROPS}
      width={12}
      height={12}
      className="language-dropdown-chevron"
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

export function ThemeDropdown({ className }: { className?: string }) {
  const { preference, setPreference } = useTheme();
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<Record<ThemePreference, HTMLButtonElement | null>>({
    system: null,
    light: null,
    dark: null,
  });

  function closeDropdown(refocusTrigger = true) {
    setOpen(false);
    if (refocusTrigger) {
      window.requestAnimationFrame(() => triggerRef.current?.focus());
    }
  }

  function openDropdown() {
    setOpen(true);
    window.requestAnimationFrame(() => optionRefs.current[preference]?.focus());
  }

  function selectOption(option: ThemePreference) {
    setPreference(option);
    closeDropdown();
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Escape" || !open) return;
    event.preventDefault();
    event.stopPropagation();
    closeDropdown();
  }

  return (
    <div
      className={`language-dropdown theme-dropdown${
        className ? ` ${className}` : ""
      }`}
      onBlur={(event) => {
        if (
          open &&
          !event.currentTarget.contains(event.relatedTarget as Node | null)
        ) {
          closeDropdown(false);
        }
      }}
      onKeyDown={handleKeyDown}
    >
      <button
        ref={triggerRef}
        type="button"
        className="language-dropdown-trigger theme-dropdown-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`${t("components.themeDropdown.label")}: ${t(
          THEME_LABEL_KEYS[preference]
        )}`}
        onClick={() => (open ? closeDropdown() : openDropdown())}
      >
        <ThemeIcon />
        <span className="language-dropdown-label">
          {t(THEME_LABEL_KEYS[preference])}
        </span>
        <ChevronIcon />
      </button>

      {open && (
        <div
          className="language-dropdown-menu theme-dropdown-menu"
          role="listbox"
          aria-label={t("components.themeDropdown.label")}
        >
          <div
            className="language-dropdown-options theme-dropdown-options"
            data-tv-scroll-container
            data-tv-scroll-axis="vertical"
            data-navigation-scroll-key="theme:options"
          >
            {THEME_OPTIONS.map((option) => {
              const selected = option === preference;
              return (
                <button
                  key={option}
                  ref={(element) => {
                    optionRefs.current[option] = element;
                  }}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  className={`language-dropdown-option${
                    selected ? " is-selected" : ""
                  }`}
                  onClick={() => selectOption(option)}
                >
                  <span>{t(THEME_LABEL_KEYS[option])}</span>
                  {selected && (
                    <span className="language-dropdown-check" aria-hidden="true">
                      ✓
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
