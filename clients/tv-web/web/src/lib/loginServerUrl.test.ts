import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { rememberGroup } from "@playarr-tv/domain";
import { initialLoginServerUrl, publicIpv4RelayUrl } from "./loginServerUrl";

/** Matches `knownServers.test.ts`'s own `localStorage` stub convention. */
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

beforeEach(() => {
  vi.stubGlobal("localStorage", createMemoryLocalStorage());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("initialLoginServerUrl", () => {
  // These first two cases are the rollout invariant (`docs/architecture/
  // peer-groups.md`'s top, restated in §7.3): with neither a legacy
  // `apiBaseUrl` nor a remembered `KnownServerGroup` ever stored (this
  // file's own `beforeEach` starts every test with empty storage), the
  // hosted form must blank exactly as it always has.
  it("leaves the server blank on the hosted Playarr origin", () => {
    expect(initialLoginServerUrl("https://playarr.app", "playarr.app")).toBe("");
  });

  it("does not prefill a previously selected server on hosted Playarr", () => {
    expect(initialLoginServerUrl("http://203.0.113.10:8080", "playarr.app")).toBe("");
  });

  it("preserves same-origin defaults for self-hosted clients", () => {
    expect(initialLoginServerUrl("https://media.example.com", "media.example.com")).toBe(
      "https://media.example.com"
    );
  });

  it("prefills on hosted Playarr when a legacy apiBaseUrl is stored", () => {
    localStorage.setItem("playarr:apiBaseUrl", "https://home.example.com");
    expect(initialLoginServerUrl("https://home.example.com", "playarr.app")).toBe(
      "https://home.example.com"
    );
  });

  it("prefills on hosted Playarr when a KnownServerGroup is remembered, even with no legacy apiBaseUrl", () => {
    rememberGroup({ servers: [{ url: "https://home.example.com" }], lastGoodUrl: "https://home.example.com" });
    expect(initialLoginServerUrl("https://home.example.com", "playarr.app")).toBe(
      "https://home.example.com"
    );
  });

  it("still blanks on hosted Playarr once forgetGroup-equivalent empty storage is restored", () => {
    // No group, no legacy key (this test's own `beforeEach` storage) --
    // confirms the blank path isn't a one-time fluke of test ordering.
    expect(initialLoginServerUrl("https://playarr.app", "playarr.app")).toBe("");
  });
});

describe("publicIpv4RelayUrl", () => {
  it.each([
    "11.22.33.44",
    "11.22.33.44:8080",
    "http://11.22.33.44",
    "http://11.22.33.44:8080",
    "https://11.22.33.44",
    "https://11.22.33.44:9443",
    "//11.22.33.44:8080",
    "  11.22.33.44:8080  ",
  ])("normalises public IPv4 form %s to the relay address", (value) => {
    expect(publicIpv4RelayUrl(value)).toBe(
      "https://v4-11-22-33-44.relay.playarr.app:8484"
    );
  });

  it.each([
    "v4-203-0-113-10.relay.playarr.app",
    "http://v4-203-0-113-10.relay.playarr.app",
    "https://v4-203-0-113-10.relay.playarr.app",
  ])("normalises relay hostname form %s to HTTPS on the Playarr Server port", (value) => {
    expect(publicIpv4RelayUrl(value)).toBe(
      "https://v4-203-0-113-10.relay.playarr.app:8484"
    );
  });

  it.each([
    "11.22.33.44:8080/api?q=one#result",
    "http://11.22.33.44:8080/api?q=one#result",
    "https://11.22.33.44:9443/api?q=one#result",
  ])("preserves paths, queries, and fragments for %s", (value) => {
    expect(publicIpv4RelayUrl(value)).toBe(
      "https://v4-11-22-33-44.relay.playarr.app:8484/api?q=one#result"
    );
  });

  it("normalises a root query without retaining a redundant slash", () => {
    expect(publicIpv4RelayUrl("11.22.33.44:8080?q=one#result")).toBe(
      "https://v4-11-22-33-44.relay.playarr.app:8484?q=one#result"
    );
  });

  it.each([
    "http://192.168.1.20:8484",
    "http://203.0.113.10:8484",
    "http://localhost:8484",
    "http://media.example.com:8484",
    "https://203.0.113.10:8484",
    "http://[2001:db8::1]:8484",
    "not a URL",
  ])("leaves unsupported address %s unchanged", (value) => {
    expect(publicIpv4RelayUrl(value)).toBe(value);
  });
});
