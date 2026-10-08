import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type ThemePreference = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

const THEME_STORAGE_KEY = "playarr-theme";
const DARK_MODE_QUERY = "(prefers-color-scheme: dark)";

interface ThemeContextValue {
  preference: ThemePreference;
  resolvedTheme: ResolvedTheme;
  setPreference: (preference: ThemePreference) => void;
  toggleTheme: () => void;
}

export const ThemeContext = createContext<ThemeContextValue | null>(null);

function storedPreference(): ThemePreference {
  if (typeof window === "undefined") return "system";
  const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
  return stored === "light" || stored === "dark" ? stored : "system";
}

function systemTheme(): ResolvedTheme {
  if (typeof window === "undefined") return "light";
  return window.matchMedia(DARK_MODE_QUERY).matches ? "dark" : "light";
}

/**
 * Playarr's independent light/dark theme controller. The system colour
 * scheme is the default; choosing light or dark persists an explicit
 * override until the user selects "System" again.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<ThemePreference>(storedPreference);
  const [systemPreference, setSystemPreference] = useState<ResolvedTheme>(systemTheme);
  const resolvedTheme = preference === "system" ? systemPreference : preference;

  useEffect(() => {
    const media = window.matchMedia(DARK_MODE_QUERY);
    const handleChange = (event: MediaQueryListEvent) => {
      setSystemPreference(event.matches ? "dark" : "light");
    };
    setSystemPreference(media.matches ? "dark" : "light");
    media.addEventListener("change", handleChange);
    return () => media.removeEventListener("change", handleChange);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = resolvedTheme;
    document.documentElement.dataset.themePreference = preference;
    document.documentElement.style.colorScheme = resolvedTheme;
  }, [preference, resolvedTheme]);

  function setPreference(nextPreference: ThemePreference) {
    setPreferenceState(nextPreference);
    if (nextPreference === "system") {
      window.localStorage.removeItem(THEME_STORAGE_KEY);
    } else {
      window.localStorage.setItem(THEME_STORAGE_KEY, nextPreference);
    }
  }

  const value = useMemo<ThemeContextValue>(
    () => ({
      preference,
      resolvedTheme,
      setPreference,
      toggleTheme: () => setPreference(resolvedTheme === "dark" ? "light" : "dark"),
    }),
    [preference, resolvedTheme]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used within ThemeProvider");
  }
  return context;
}
