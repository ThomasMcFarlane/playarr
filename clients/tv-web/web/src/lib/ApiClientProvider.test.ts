import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LoginResponse, RefreshResponse } from "@playarr-tv/api-client";
import { readKnownServers, rememberGroup, setStoredApiBaseUrl } from "@playarr-tv/domain";
import { createManagedApiClient, resolveInitialApiBaseUrl } from "./ApiClientProvider";

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

function stubWindowLocation(href: string): void {
  const url = new URL(href);
  vi.stubGlobal("window", {
    location: {
      origin: url.origin,
      search: url.search,
      hostname: url.hostname,
    },
  });
}

function mockFetch(handler: (request: Request) => Response | Promise<Response>) {
  return vi.fn(async (request: Request) => handler(request));
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const LOGIN_RESPONSE_BASE: Omit<LoginResponse, "peer_addresses"> = {
  access_token: "at-1",
  refresh_token: "rt-1",
  token_type: "Bearer",
  expires_in: 3600,
  user_id: "00000000-0000-0000-0000-000000000009",
};

beforeEach(() => {
  vi.stubGlobal("localStorage", createMemoryLocalStorage());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// `docs/architecture/peer-groups.md`'s rollout invariant, restated in §7.3:
// for a client with no `KnownServerGroup` ever stored, every §7 change is a
// complete no-op -- the existing single-`apiBaseUrl` code path is exercised
// byte for byte, exactly as it is today.
describe("resolveInitialApiBaseUrl -- rollout invariant (no KnownServerGroup ever stored)", () => {
  it("falls back to this page's own origin when nothing is stored and no query param is present", () => {
    stubWindowLocation("https://media.example.com/login");
    expect(resolveInitialApiBaseUrl()).toBe("https://media.example.com");
  });

  it("prefers a legacy stored apiBaseUrl over same-origin, unchanged", () => {
    stubWindowLocation("https://media.example.com/login");
    setStoredApiBaseUrl("http://192.168.1.20:8484");
    expect(resolveInitialApiBaseUrl()).toBe("http://192.168.1.20:8484");
  });

  it("prefers a ?apiBaseUrl= query param over same-origin when nothing is stored, unchanged", () => {
    stubWindowLocation("https://media.example.com/login?apiBaseUrl=http%3A%2F%2F10.0.0.5%3A8484");
    expect(resolveInitialApiBaseUrl()).toBe("http://10.0.0.5:8484");
  });

  it("still prefers a legacy stored apiBaseUrl over a query param, unchanged priority order", () => {
    stubWindowLocation("https://media.example.com/login?apiBaseUrl=http%3A%2F%2F10.0.0.5%3A8484");
    setStoredApiBaseUrl("http://192.168.1.20:8484");
    expect(resolveInitialApiBaseUrl()).toBe("http://192.168.1.20:8484");
  });
});

describe("resolveInitialApiBaseUrl -- group-aware (§7.3)", () => {
  it("prefers a remembered group's lastGoodUrl over a legacy stored apiBaseUrl", () => {
    stubWindowLocation("https://media.example.com/login");
    setStoredApiBaseUrl("http://192.168.1.20:8484");
    rememberGroup({
      servers: [{ url: "https://home.example.com" }, { url: "https://east.example.com" }],
      lastGoodUrl: "https://east.example.com",
    });
    expect(resolveInitialApiBaseUrl()).toBe("https://east.example.com");
  });

  it("falls back to servers[0] when a remembered group has no lastGoodUrl yet", () => {
    stubWindowLocation("https://media.example.com/login");
    rememberGroup({ servers: [{ url: "https://home.example.com" }, { url: "https://east.example.com" }] });
    expect(resolveInitialApiBaseUrl()).toBe("https://home.example.com");
  });

  it("falls back to the legacy chain when a remembered group exists but has zero servers", () => {
    stubWindowLocation("https://media.example.com/login");
    setStoredApiBaseUrl("http://192.168.1.20:8484");
    rememberGroup({ servers: [] });
    expect(resolveInitialApiBaseUrl()).toBe("http://192.168.1.20:8484");
  });
});

// §7.1's self-healing. Every `ApiClient` this provider builds goes through
// `createManagedApiClient`; these tests exercise that factory directly
// rather than rendering the full React provider (no test in this package
// renders `<ApiClientProvider>` today -- see this file's sibling tests for
// the same "test the pure/exported pieces" convention).
describe("createManagedApiClient -- rollout invariant (peer_addresses: null)", () => {
  it("does not remember a group when a login response carries peer_addresses: null (a standalone node)", async () => {
    const client = createManagedApiClient({
      baseUrl: "https://home.example.com",
      fetchImpl: mockFetch(() =>
        jsonResponse(200, { ...LOGIN_RESPONSE_BASE, peer_addresses: null })
      ),
    });

    await client.login({
      device_id: "d1",
      device_name: "Test",
      client_platform: "web",
      client_version: "1.0.0",
    });

    expect(readKnownServers()).toBeUndefined();
  });

  it("does not remember a group on a successful (non-auth) call either, when none was ever remembered", async () => {
    const client = createManagedApiClient({
      baseUrl: "https://home.example.com",
      fetchImpl: mockFetch(() =>
        jsonResponse(200, {
          server_version: "1.0.0",
          api_version: "1",
          instance_name: "Home",
          compatible_clients: [],
        })
      ),
    });

    await client.getVersion();

    expect(readKnownServers()).toBeUndefined();
  });
});

describe("createManagedApiClient -- self-healing", () => {
  it("remembers a new group from a login response's peer_addresses, promoting the responding url to lastGoodUrl", async () => {
    const client = createManagedApiClient({
      baseUrl: "https://home.example.com",
      fetchImpl: mockFetch(() =>
        jsonResponse(200, {
          ...LOGIN_RESPONSE_BASE,
          peer_addresses: {
            group_id: "11111111-1111-4111-8111-111111111111",
            group_name: "Home Group",
            addresses: [
              { peer_node_id: "11111111-1111-4111-8111-111111111111", url: "https://home.example.com" },
              { peer_node_id: "22222222-2222-4222-8222-222222222222", url: "https://east.example.com" },
            ],
          },
        })
      ),
    });

    await client.login({
      device_id: "d1",
      device_name: "Test",
      client_platform: "web",
      client_version: "1.0.0",
    });

    expect(readKnownServers()).toEqual({
      groupId: "11111111-1111-4111-8111-111111111111",
      groupName: "Home Group",
      servers: [
        { url: "https://home.example.com", peerNodeId: "11111111-1111-4111-8111-111111111111" },
        { url: "https://east.example.com", peerNodeId: "22222222-2222-4222-8222-222222222222" },
      ],
      lastGoodUrl: "https://home.example.com",
    });
  });

  it("preserves a still-listed, non-responding address's lastSuccessAt across a membership refresh", async () => {
    // "north" isn't the server this client talks to, so nothing about this
    // call should touch its `lastSuccessAt` -- only `home` (the address
    // that actually just answered, via `withServerSuccessTracking`) is
    // expected to move.
    rememberGroup({
      servers: [
        { url: "https://home.example.com", lastSuccessAt: 1000 },
        { url: "https://north.example.com", lastSuccessAt: 5000 },
      ],
      lastGoodUrl: "https://home.example.com",
    });
    const beforeCall = Date.now();
    const client = createManagedApiClient({
      baseUrl: "https://home.example.com",
      fetchImpl: mockFetch(() =>
        jsonResponse(200, {
          ...LOGIN_RESPONSE_BASE,
          peer_addresses: {
            group_id: null,
            group_name: null,
            // "north" stays, "east" has newly joined.
            addresses: [
              { peer_node_id: "11111111-1111-4111-8111-111111111111", url: "https://home.example.com" },
              { peer_node_id: "33333333-3333-4333-8333-333333333333", url: "https://north.example.com" },
              { peer_node_id: "22222222-2222-4222-8222-222222222222", url: "https://east.example.com" },
            ],
          },
        })
      ),
    });

    await client.login({
      device_id: "d1",
      device_name: "Test",
      client_platform: "web",
      client_version: "1.0.0",
    });

    const group = readKnownServers();
    const home = group?.servers.find((server) => server.url === "https://home.example.com");
    const north = group?.servers.find((server) => server.url === "https://north.example.com");
    const east = group?.servers.find((server) => server.url === "https://east.example.com");
    // `home` just answered -- `withServerSuccessTracking` bumped it to "now",
    // not the stale 1000 it started with.
    expect(home?.lastSuccessAt).toBeGreaterThanOrEqual(beforeCall);
    // `north` never got called -- untouched.
    expect(north?.lastSuccessAt).toBe(5000);
    // `east` is brand new -- nothing to preserve.
    expect(east?.lastSuccessAt).toBeUndefined();
  });

  it("bumps rememberServerSuccess/lastGoodUrl on any successful (non-auth) call once a group is already remembered", async () => {
    rememberGroup({
      servers: [{ url: "https://home.example.com" }, { url: "https://east.example.com" }],
      lastGoodUrl: "https://home.example.com",
    });
    const client = createManagedApiClient({
      baseUrl: "https://east.example.com",
      fetchImpl: mockFetch(() =>
        jsonResponse(200, {
          server_version: "1.0.0",
          api_version: "1",
          instance_name: "East",
          compatible_clients: [],
        })
      ),
    });

    await client.getVersion();

    expect(readKnownServers()?.lastGoodUrl).toBe("https://east.example.com");
  });

  it("does not mark a server successful for a non-2xx response", async () => {
    rememberGroup({
      servers: [{ url: "https://home.example.com" }],
      lastGoodUrl: "https://home.example.com",
    });
    const client = createManagedApiClient({
      baseUrl: "https://home.example.com",
      fetchImpl: mockFetch(() => new Response(null, { status: 500 })),
    });

    await expect(client.getVersion()).rejects.toThrow();

    // lastGoodUrl is untouched -- still whatever it was, not re-stamped by a failed call.
    expect(readKnownServers()?.lastGoodUrl).toBe("https://home.example.com");
  });

  it("folds peer_addresses from a refresh response the same way as login", async () => {
    const client = createManagedApiClient({
      baseUrl: "https://home.example.com",
      fetchImpl: mockFetch(() =>
        jsonResponse(200, {
          access_token: "at-2",
          refresh_token: "rt-2",
          token_type: "Bearer",
          expires_in: 3600,
          user_id: "00000000-0000-0000-0000-000000000009",
          peer_addresses: {
            group_id: "22222222-2222-4222-8222-222222222222",
            group_name: null,
            addresses: [{ peer_node_id: "11111111-1111-4111-8111-111111111111", url: "https://home.example.com" }],
          },
        } satisfies RefreshResponse)
      ),
    });

    await client.refresh({ device_id: "d1", refresh_token: "rt-old" });

    expect(readKnownServers()?.groupId).toBe("22222222-2222-4222-8222-222222222222");
  });
});
