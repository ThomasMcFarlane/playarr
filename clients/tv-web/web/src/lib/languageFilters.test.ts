import { describe, expect, it } from "vitest";
import {
  formatLanguageParam,
  languageDisplayName,
  parseLanguageParam,
  toggleLanguage,
} from "./languageFilters";

describe("language filter query", () => {
  it("parses, lower-cases and de-duplicates", () => {
    expect(parseLanguageParam("EN, ja,,en")).toEqual(["en", "ja"]);
    expect(parseLanguageParam(null)).toEqual([]);
    expect(parseLanguageParam("")).toEqual([]);
  });

  it("formats selections and omits an empty one", () => {
    expect(formatLanguageParam(["en", "ja"])).toBe("en,ja");
    expect(formatLanguageParam([])).toBeUndefined();
  });

  it("toggles membership", () => {
    expect(toggleLanguage(["en"], "ja")).toEqual(["en", "ja"]);
    expect(toggleLanguage(["en", "ja"], "en")).toEqual(["ja"]);
  });
});

describe("languageDisplayName", () => {
  it("localises to the given locale", () => {
    expect(languageDisplayName("ja", "en")).toBe("Japanese");
    expect(languageDisplayName("ja", "ja")).toBe("日本語");
  });

  it("falls back to the server name, then the code", () => {
    expect(languageDisplayName("zz-bad-code-!", "en", "Fallback")).toBe("Fallback");
    expect(languageDisplayName("zzq", "en")).toMatch(/ZZQ|zzq/i);
  });
});
