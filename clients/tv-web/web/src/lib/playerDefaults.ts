export const PLAYER_DEFAULTS_STORAGE_KEY = "playarr.player-defaults.v1";

export const PLAYER_QUALITY_DEFAULTS = [
  { id: "original", label: "Original", detail: "Best available source" },
  { id: "h264-1080p-8mbps", label: "1080p", detail: "Up to 8 Mbps" },
  { id: "h264-720p-4mbps", label: "720p", detail: "Up to 4 Mbps" },
  { id: "h264-480p-2mbps", label: "480p", detail: "Up to 2 Mbps" },
] as const;

export type PlayerQualityDefault = (typeof PLAYER_QUALITY_DEFAULTS)[number]["id"];
export type PlayerSubtitleDefault = "off" | "forced" | "always";

export interface PlayerDefaults {
  qualityId: PlayerQualityDefault;
  subtitleMode: PlayerSubtitleDefault;
  subtitleLanguage: string;
}

export interface SubtitleDefaultCandidate {
  id: string;
  forced: boolean;
  is_default: boolean;
  language?: string | null;
}

export const DEFAULT_PLAYER_DEFAULTS: PlayerDefaults = {
  qualityId: "original",
  subtitleMode: "off",
  subtitleLanguage: "en",
};

function browserStorage(): Storage | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

function isQualityDefault(value: unknown): value is PlayerQualityDefault {
  return PLAYER_QUALITY_DEFAULTS.some((option) => option.id === value);
}

function isSubtitleDefault(value: unknown): value is PlayerSubtitleDefault {
  return value === "off" || value === "forced" || value === "always";
}

export function readPlayerDefaults(storage = browserStorage()): PlayerDefaults {
  if (!storage) return DEFAULT_PLAYER_DEFAULTS;
  try {
    const parsed = JSON.parse(storage.getItem(PLAYER_DEFAULTS_STORAGE_KEY) ?? "null") as
      | Partial<PlayerDefaults>
      | null;
    return {
      qualityId: isQualityDefault(parsed?.qualityId)
        ? parsed.qualityId
        : DEFAULT_PLAYER_DEFAULTS.qualityId,
      subtitleMode: isSubtitleDefault(parsed?.subtitleMode)
        ? parsed.subtitleMode
        : DEFAULT_PLAYER_DEFAULTS.subtitleMode,
      subtitleLanguage:
        typeof parsed?.subtitleLanguage === "string" && parsed.subtitleLanguage.trim()
          ? parsed.subtitleLanguage.trim().toLowerCase()
          : DEFAULT_PLAYER_DEFAULTS.subtitleLanguage,
    };
  } catch {
    return DEFAULT_PLAYER_DEFAULTS;
  }
}

export function writePlayerDefaults(
  defaults: PlayerDefaults,
  storage = browserStorage()
): void {
  storage?.setItem(PLAYER_DEFAULTS_STORAGE_KEY, JSON.stringify(defaults));
}

const LANGUAGE_ALIASES: Record<string, string> = {
  ara: "ar",
  chi: "zh",
  deu: "de",
  eng: "en",
  fra: "fr",
  fre: "fr",
  ger: "de",
  hin: "hi",
  ita: "it",
  jpn: "ja",
  kor: "ko",
  por: "pt",
  spa: "es",
  tha: "th",
  zho: "zh",
};

function normaliseLanguage(value: string | null | undefined): string {
  const language = value?.trim().toLowerCase().split(/[-_]/, 1)[0] ?? "";
  return LANGUAGE_ALIASES[language] ?? language;
}

export function selectDefaultSubtitleTrackId(
  tracks: readonly SubtitleDefaultCandidate[],
  defaults: PlayerDefaults
): string | null {
  if (defaults.subtitleMode === "off") return null;

  const eligible =
    defaults.subtitleMode === "forced"
      ? tracks.filter((track) => track.forced)
      : [...tracks];
  if (eligible.length === 0) return null;

  const preferredLanguage = normaliseLanguage(defaults.subtitleLanguage);
  const languageMatch = eligible.find(
    (track) => normaliseLanguage(track.language) === preferredLanguage
  );
  return languageMatch?.id ?? eligible.find((track) => track.is_default)?.id ?? eligible[0]!.id;
}
