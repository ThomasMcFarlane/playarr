import { afterEach, describe, expect, it, vi } from "vitest";
import { TokenStore, type StoredSession } from "./tokenStore";

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

const session: StoredSession = {
  accessToken: "at-1",
  refreshToken: "rt-1",
  tokenType: "Bearer",
  expiresAt: Date.now() + 60_000,
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("TokenStore", () => {
  it("returns undefined before anything has been set", () => {
    const store = new TokenStore();
    expect(store.get()).toBeUndefined();
    expect(store.hasValidAccessToken()).toBe(false);
  });

  it("returns what was set", () => {
    const store = new TokenStore();
    store.set(session);
    expect(store.get()).toEqual(session);
  });

  it("treats a session past its expiresAt as invalid, and one before it as valid", () => {
    const store = new TokenStore();
    store.set({ ...session, expiresAt: Date.now() + 60_000 });
    expect(store.hasValidAccessToken()).toBe(true);

    store.set({ ...session, expiresAt: Date.now() - 1 });
    expect(store.hasValidAccessToken()).toBe(false);
  });

  it("clear() removes the stored session", () => {
    const store = new TokenStore();
    store.set(session);
    store.clear();
    expect(store.get()).toBeUndefined();
  });

  it("persists to localStorage when available, and a fresh TokenStore reads it back", () => {
    vi.stubGlobal("localStorage", createMemoryLocalStorage());

    const first = new TokenStore();
    first.set(session);

    const second = new TokenStore();
    expect(second.get()).toEqual(session);
  });

  it("clear() removes the persisted value too", () => {
    vi.stubGlobal("localStorage", createMemoryLocalStorage());

    const first = new TokenStore();
    first.set(session);
    first.clear();

    const second = new TokenStore();
    expect(second.get()).toBeUndefined();
  });

  it("ignores a corrupt/foreign value under its storage key instead of throwing", () => {
    const storage = createMemoryLocalStorage();
    storage.setItem("streamarr:session", "not json");
    vi.stubGlobal("localStorage", storage);

    expect(() => new TokenStore()).not.toThrow();
    expect(new TokenStore().get()).toBeUndefined();
  });

  it("works entirely in-memory when localStorage is unavailable (no throw, nothing persisted)", () => {
    vi.stubGlobal("localStorage", undefined);
    const store = new TokenStore();
    store.set(session);
    expect(store.get()).toEqual(session);
  });
});
