import { describe, expect, it } from "vitest";
import {
  DEFAULT_PLAYER_DEFAULTS,
  PLAYER_DEFAULTS_STORAGE_KEY,
  readPlayerDefaults,
  selectDefaultSubtitleTrackId,
  writePlayerDefaults,
} from "./playerDefaults";

function memoryStorage(initial?: string): Storage {
  const values = new Map<string, string>();
  if (initial !== undefined) values.set(PLAYER_DEFAULTS_STORAGE_KEY, initial);
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, value),
  };
}

describe("player defaults", () => {
  it("falls back safely when stored settings are invalid", () => {
    expect(readPlayerDefaults(memoryStorage("not-json"))).toEqual(DEFAULT_PLAYER_DEFAULTS);
    expect(
      readPlayerDefaults(
        memoryStorage(JSON.stringify({ qualityId: "4k", subtitleMode: "sometimes" }))
      )
    ).toEqual(DEFAULT_PLAYER_DEFAULTS);
  });

  it("persists supported quality and subtitle defaults", () => {
    const storage = memoryStorage();
    const defaults = {
      qualityId: "h264-1080p-8mbps" as const,
      subtitleMode: "always" as const,
      subtitleLanguage: "ja",
    };

    writePlayerDefaults(defaults, storage);

    expect(readPlayerDefaults(storage)).toEqual(defaults);
  });

  it("selects preferred-language subtitles and respects forced-only mode", () => {
    const tracks = [
      { id: "english", language: "eng", forced: false, is_default: true },
      { id: "japanese", language: "ja", forced: false, is_default: false },
      { id: "forced", language: "en", forced: true, is_default: false },
    ];

    expect(
      selectDefaultSubtitleTrackId(tracks, {
        ...DEFAULT_PLAYER_DEFAULTS,
        subtitleMode: "always",
        subtitleLanguage: "ja",
      })
    ).toBe("japanese");
    expect(
      selectDefaultSubtitleTrackId(tracks, {
        ...DEFAULT_PLAYER_DEFAULTS,
        subtitleMode: "forced",
      })
    ).toBe("forced");
    expect(selectDefaultSubtitleTrackId(tracks, DEFAULT_PLAYER_DEFAULTS)).toBeNull();
  });
});
