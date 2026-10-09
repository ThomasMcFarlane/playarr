export type ResolvedLanguage = "en" | "th" | "ja";
export type LanguagePreference = "system" | ResolvedLanguage;

export const SUPPORTED_LANGUAGES: readonly ResolvedLanguage[] = ["en", "th", "ja"];

export const LANGUAGE_NAMES: Record<ResolvedLanguage, string> = {
  en: "English",
  th: "ไทย",
  ja: "日本語",
};

const LOCALE_TAGS: Record<ResolvedLanguage, string> = { en: "en-GB", th: "th-TH", ja: "ja-JP" };

/** The BCP 47 tag the UI formats dates, times and numbers with for a language. */
export function localeTagFor(language: string): string {
  return LOCALE_TAGS[language as ResolvedLanguage] ?? LOCALE_TAGS.en;
}

const DEFAULT_LANGUAGE: ResolvedLanguage = "en";

function isResolvedLanguage(value: string): value is ResolvedLanguage {
  return (SUPPORTED_LANGUAGES as readonly string[]).includes(value);
}

export function isLanguagePreference(value: string): value is LanguagePreference {
  return value === "system" || isResolvedLanguage(value);
}

/**
 * Matches `navigator.languages` (falling back to `navigator.language`)
 * against `SUPPORTED_LANGUAGES`, comparing base language subtags only (eg.
 * `th-TH` and `ja-JP` both match) so a supported language earlier in the
 * user's preference list always wins over an unsupported one that's closer
 * to their exact region. Unset/unsupported resolves to English.
 */
export function detectBrowserLanguage(): ResolvedLanguage {
  if (typeof navigator === "undefined") return DEFAULT_LANGUAGE;
  const candidates =
    navigator.languages && navigator.languages.length > 0
      ? navigator.languages
      : [navigator.language];

  for (const candidate of candidates) {
    if (!candidate) continue;
    const subtag = candidate.toLowerCase().split("-")[0] ?? "";
    if (isResolvedLanguage(subtag)) return subtag;
  }
  return DEFAULT_LANGUAGE;
}
