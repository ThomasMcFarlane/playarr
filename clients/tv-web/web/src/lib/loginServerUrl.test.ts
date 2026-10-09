import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { rememberGroup } from "@playarr-tv/domain";
import { initialLoginServerUrl, probeRelayCandidate, publicIpv4RelayUrl, resolveRelayAddress } from "./loginServerUrl";

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

describe("publicIpv4RelayUrl on a plain-http page", () => {
  it("leaves the address as entered (the server-hosted /tv/ client)", () => {
    expect(publicIpv4RelayUrl("http://11.22.33.44:8484", "http:")).toBe("http://11.22.33.44:8484");
  });

  it("still maps a public address to its secure name from an https page", () => {
    expect(publicIpv4RelayUrl("http://11.22.33.44:8484", "https:")).toBe(
      "https://v4-11-22-33-44.relay.playarr.app:8484"
    );
  });
});

describe("publicIpv4RelayUrl", () => {
  it.each([
    "11.22.33.44",
    "http://11.22.33.44",
    "https://11.22.33.44",
    "//11.22.33.44",
    "  11.22.33.44  ",
  ])("normalises bare public IPv4 form %s to the port-less relay address", (value) => {
    expect(publicIpv4RelayUrl(value)).toBe("https://v4-11-22-33-44.relay.playarr.app");
  });

  it.each([
    ["11.22.33.44:8080", ":8080"],
    ["http://11.22.33.44:8080", ":8080"],
    ["https://11.22.33.44:9443", ":9443"],
    ["//11.22.33.44:8080", ":8080"],
    ["https://11.22.33.44:443", ":443"],
    ["v4-11-22-33-44.relay.playarr.app:8484", ":8484"],
  ])("respects the explicit port typed in %s exactly", (value, port) => {
    expect(publicIpv4RelayUrl(value)).toBe(`https://v4-11-22-33-44.relay.playarr.app${port}`);
  });

  it("preserves an explicitly selected legacy relay port", () => {
    expect(publicIpv4RelayUrl("http://11.22.33.44:8484")).toBe(
      "https://v4-11-22-33-44.relay.playarr.app:8484"
    );
  });

  it.each([
    "v4-11-22-33-44.relay.playarr.app",
    "http://v4-11-22-33-44.relay.playarr.app",
    "https://v4-11-22-33-44.relay.playarr.app",
  ])("normalises relay hostname form %s to the HTTPS default port", (value) => {
    expect(publicIpv4RelayUrl(value)).toBe(
      "https://v4-11-22-33-44.relay.playarr.app"
    );
  });

  it.each([
    ["11.22.33.44/api?q=one#result", ""],
    ["http://11.22.33.44:8080/api?q=one#result", ":8080"],
    ["https://11.22.33.44:9443/api?q=one#result", ":9443"],
  ])("preserves paths, queries, and fragments for %s", (value, port) => {
    expect(publicIpv4RelayUrl(value)).toBe(
      `https://v4-11-22-33-44.relay.playarr.app${port}/api?q=one#result`
    );
  });

  it("normalises a root query without retaining a redundant slash", () => {
    expect(publicIpv4RelayUrl("11.22.33.44?q=one#result")).toBe(
      "https://v4-11-22-33-44.relay.playarr.app?q=one#result"
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

describe("resolveRelayAddress (443 then 8484 fallback)", () => {
  const BARE = "https://v4-11-22-33-44.relay.playarr.app";
  const only = (...answering: string[]) => vi.fn(async (url: string) => answering.includes(url));

  it("tries 443 first and keeps it when it answers", async () => {
    const probe = only(BARE);
    expect(await resolveRelayAddress("11.22.33.44", { probe })).toBe(BARE);
    expect(probe.mock.calls.map((call) => call[0])).toEqual([BARE]);
  });

  it("falls back to 8484 when 443 does not answer, trying 443 first", async () => {
    const probe = only(`${BARE}:8484`);
    expect(await resolveRelayAddress("11.22.33.44", { probe })).toBe(`${BARE}:8484`);
    expect(probe.mock.calls.map((call) => call[0])).toEqual([BARE, `${BARE}:8484`]);
  });

  it("keeps the path when falling back", async () => {
    const probe = only(`${BARE}:8484/base`);
    expect(await resolveRelayAddress("http://11.22.33.44/base", { probe })).toBe(`${BARE}:8484/base`);
  });

  it("returns the 443 address when neither port answers", async () => {
    const probe = only();
    expect(await resolveRelayAddress("11.22.33.44", { probe })).toBe(BARE);
    expect(probe).toHaveBeenCalledTimes(2);
  });

  it("persists the working 8484 port: later calls, sync and async, go straight there", async () => {
    await resolveRelayAddress("11.22.33.44", { probe: only(`${BARE}:8484`) });
    const probe = only();
    expect(await resolveRelayAddress("11.22.33.44", { probe })).toBe(`${BARE}:8484`);
    expect(probe).not.toHaveBeenCalled();
    expect(publicIpv4RelayUrl("11.22.33.44")).toBe(`${BARE}:8484`);
    expect(publicIpv4RelayUrl(BARE)).toBe(`${BARE}:8484`);
  });

  it("persists a working 443 and never probes again", async () => {
    await resolveRelayAddress("11.22.33.44", { probe: only(BARE) });
    const probe = only();
    expect(await resolveRelayAddress("11.22.33.44", { probe })).toBe(BARE);
    expect(probe).not.toHaveBeenCalled();
  });

  it("does not persist anything when nothing answers", async () => {
    await resolveRelayAddress("11.22.33.44", { probe: only() });
    expect(publicIpv4RelayUrl("11.22.33.44")).toBe(BARE);
  });

  it.each(["11.22.33.44:8080", "11.22.33.44:8484", "https://11.22.33.44:443"])(
    "respects an explicit port exactly and never probes: %s",
    async (value) => {
      const probe = only();
      expect(await resolveRelayAddress(value, { probe })).toBe(publicIpv4RelayUrl(value));
      expect(probe).not.toHaveBeenCalled();
    }
  );

  it.each(["192.168.1.20", "http://192.168.1.20:8484", "http://localhost:8484", "http://203.0.113.10"])(
    "leaves local and private address %s unchanged and unprobed",
    async (value) => {
      const probe = only();
      expect(await resolveRelayAddress(value, { probe })).toBe(value);
      expect(probe).not.toHaveBeenCalled();
    }
  );

  it("does not rewrite or probe on a plain-http page", async () => {
    const probe = only();
    expect(await resolveRelayAddress("11.22.33.44", { probe, pageProtocol: "http:" })).toBe("11.22.33.44");
    expect(probe).not.toHaveBeenCalled();
  });
});

describe("probeRelayCandidate", () => {
  it("requests /api/system/version and is true only for an OK answer", async () => {
    const urls: string[] = [];
    const ok = async (request: Request) => {
      urls.push(request.url);
      return new Response("{}", { status: 200 });
    };
    expect(await probeRelayCandidate("https://h.example.com:8484/", ok)).toBe(true);
    expect(urls).toEqual(["https://h.example.com:8484/api/system/version"]);
    expect(await probeRelayCandidate("https://h.example.com", async () => new Response("", { status: 404 }))).toBe(false);
    expect(await probeRelayCandidate("https://h.example.com", async () => { throw new TypeError("refused"); })).toBe(false);
  });

  it("gives up after the timeout", async () => {
    const hang = (request: Request) =>
      new Promise<Response>((_, reject) => request.signal.addEventListener("abort", () => reject(new Error("aborted"))));
    expect(await probeRelayCandidate("https://h.example.com", hang, 20)).toBe(false);
  });
});
