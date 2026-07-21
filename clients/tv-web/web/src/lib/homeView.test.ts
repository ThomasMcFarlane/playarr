import { describe, expect, it } from "vitest";
import {
  HOME_VIEW_STORAGE_KEY,
  readHomeViewPreference,
} from "./homeView";

function memoryStorage(value?: string): Storage {
  const values = new Map<string, string>();
  if (value !== undefined) values.set(HOME_VIEW_STORAGE_KEY, value);
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, nextValue) => values.set(key, nextValue),
  };
}

describe("home view preference", () => {
  it("defaults invalid and absent values to thumbnails", () => {
    expect(readHomeViewPreference(memoryStorage())).toBe("thumbnail");
    expect(readHomeViewPreference(memoryStorage("poster"))).toBe("thumbnail");
  });

  it("restores the saved cover view", () => {
    expect(readHomeViewPreference(memoryStorage("cover"))).toBe("cover");
  });
});
