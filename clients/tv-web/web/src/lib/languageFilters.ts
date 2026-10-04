/**
 * Audio/subtitle language filters for the library: URL query encoding
 * (`?audio=en,ja&subs=fr`) and localised language names.
 */

/** `"en,ja"` -> `["en", "ja"]`; blanks and duplicates dropped, order kept. */
export function parseLanguageParam(raw: string | null | undefined): string[] {
  if (!raw) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(",")) {
    const code = part.trim().toLowerCase();
    if (code && !seen.has(code)) {
      seen.add(code);
      out.push(code);
    }
  }
  return out;
}

/** Inverse of {@link parseLanguageParam}; `undefined` when nothing is selected. */
export function formatLanguageParam(codes: readonly string[]): string | undefined {
  return codes.length > 0 ? codes.join(",") : undefined;
}

export function toggleLanguage(codes: readonly string[], code: string): string[] {
  return codes.includes(code) ? codes.filter((c) => c !== code) : [...codes, code];
}

/**
 * The language's name in the UI locale (`ja` shows "Japanese" in English,
 * "日本語" in Japanese). Falls back to the English name from the server and
 * finally the upper-cased code.
 */
export function languageDisplayName(
  code: string,
  locale: string,
  fallbackName?: string | null
): string {
  try {
    const name = new Intl.DisplayNames([locale], { type: "language" }).of(code);
    if (name && name.toLowerCase() !== code.toLowerCase()) return name;
  } catch {
    // Unsupported locale or malformed code: use the fallbacks below.
  }
  return fallbackName || code.toUpperCase();
}
