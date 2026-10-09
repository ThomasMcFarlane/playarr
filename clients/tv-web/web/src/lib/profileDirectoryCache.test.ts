import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearProfileDirectory,
  readProfileDirectory,
  writeProfileDirectory,
} from "./profileDirectoryCache";

const profiles = [{ id: "a", username: "a", name: "A", pinLocked: false }];

describe("profile directory cache", () => {
  let store: Map<string, string>;
  beforeEach(() => {
    store = new Map();
    const storage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
    };
    vi.stubGlobal("window", { localStorage: storage });
  });

  it("returns the directory only for the same server and account", () => {
    writeProfileDirectory("https://one.example", "a", profiles);
    expect(readProfileDirectory("https://one.example", "a")).toEqual(profiles);
    expect(readProfileDirectory("https://two.example", "a")).toBeNull();
    expect(readProfileDirectory("https://one.example", "b")).toBeNull();
    expect(readProfileDirectory("https://one.example", undefined)).toBeNull();
  });

  it("drops the directory on clear and ignores malformed storage", () => {
    writeProfileDirectory("https://one.example", "a", profiles);
    clearProfileDirectory();
    expect(readProfileDirectory("https://one.example", "a")).toBeNull();
    store.set("playarr.profileDirectory.v1", "{not json");
    expect(readProfileDirectory("https://one.example", "a")).toBeNull();
  });
});
