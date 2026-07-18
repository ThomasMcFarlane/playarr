import { useTheme } from "../lib/theme";
import { useLanguage } from "../lib/i18n/LanguageProvider";

export function ThemeToggle() {
  const { resolvedTheme, toggleTheme } = useTheme();
  const { t } = useLanguage();
  const nextTheme = resolvedTheme === "dark" ? "light" : "dark";

  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={toggleTheme}
      aria-label={t("components.themeToggle.useTheme", { theme: nextTheme })}
      title={t("components.themeToggle.useTheme", { theme: nextTheme })}
    >
      {resolvedTheme === "dark" ? <SunIcon /> : <MoonIcon />}
    </button>
  );
}

function SunIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="3.5" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.65 17.65l1.42 1.42M2 12h2M20 12h2M4.93 19.07l1.42-1.42M17.65 6.35l1.42-1.42" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M20.25 15.35A8.5 8.5 0 0 1 8.65 3.75 8.5 8.5 0 1 0 20.25 15.35Z" />
    </svg>
  );
}
