import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  detectBrowserLanguage,
  isLanguagePreference,
  type LanguagePreference,
  type ResolvedLanguage,
} from "./languages";
import { translations, type TranslationKey } from "./translations";

const LANGUAGE_STORAGE_KEY = "playarr-language";

interface LanguageContextValue {
  preference: LanguagePreference;
  language: ResolvedLanguage;
  detectedLanguage: ResolvedLanguage;
  setPreference: (preference: LanguagePreference) => void;
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
}

const LanguageContext = createContext<LanguageContextValue | null>(null);

function storedPreference(): LanguagePreference {
  if (typeof window === "undefined") return "system";
  const stored = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
  return stored && isLanguagePreference(stored) ? stored : "system";
}

function interpolate(template: string, params?: Record<string, string | number>): string {
  if (!params) return template;
  return template.replace(/\{\{(\w+)\}\}/g, (match, token: string) =>
    token in params ? String(params[token]) : match
  );
}

/**
 * Playarr's UI language controller, alongside `theme.tsx`'s light/dark
 * controller. "System" is the default and auto-detects from the browser
 * (`navigator.language`), staying live via the `languagechange` event;
 * choosing a language explicitly persists an override the same way an
 * explicit theme choice does, until "System" is chosen again.
 */
export function LanguageProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<LanguagePreference>(storedPreference);
  const [detectedLanguage, setDetectedLanguage] = useState<ResolvedLanguage>(detectBrowserLanguage);
  const language = preference === "system" ? detectedLanguage : preference;

  useEffect(() => {
    const handleLanguageChange = () => setDetectedLanguage(detectBrowserLanguage());
    window.addEventListener("languagechange", handleLanguageChange);
    return () => window.removeEventListener("languagechange", handleLanguageChange);
  }, []);

  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  function setPreference(nextPreference: LanguagePreference) {
    setPreferenceState(nextPreference);
    if (nextPreference === "system") {
      window.localStorage.removeItem(LANGUAGE_STORAGE_KEY);
    } else {
      window.localStorage.setItem(LANGUAGE_STORAGE_KEY, nextPreference);
    }
  }

  const t = useMemo(() => {
    const dictionary = translations[language];
    return (key: TranslationKey, params?: Record<string, string | number>) =>
      interpolate(dictionary[key], params);
  }, [language]);

  const value = useMemo<LanguageContextValue>(
    () => ({ preference, language, detectedLanguage, setPreference, t }),
    [preference, language, detectedLanguage, t]
  );

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage(): LanguageContextValue {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error("useLanguage must be used within LanguageProvider");
  }
  return context;
}
