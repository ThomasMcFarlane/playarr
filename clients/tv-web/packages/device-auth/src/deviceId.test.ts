import { afterEach, describe, expect, it, vi } from "vitest";
import { getOrCreateDeviceId } from "./deviceId";

function createMemoryLocalStorage(): Storage {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => store.clear(),
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    get length() {
      return store.size;
    },
  } as Storage;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("getOrCreateDeviceId", () => {
  it("returns a UUID-shaped id", () => {
    vi.stubGlobal("localStorage", createMemoryLocalStorage());
    expect(getOrCreateDeviceId()).toMatch(UUID_PATTERN);
  });

  it("persists and returns the same id on subsequent calls", () => {
    vi.stubGlobal("localStorage", createMemoryLocalStorage());
    const first = getOrCreateDeviceId();
    const second = getOrCreateDeviceId();
    expect(second).toBe(first);
  });

  it("falls back to a non-persisted id (still UUID-shaped) when localStorage is unavailable", () => {
    vi.stubGlobal("localStorage", undefined);
    expect(getOrCreateDeviceId()).toMatch(UUID_PATTERN);
  });
});
