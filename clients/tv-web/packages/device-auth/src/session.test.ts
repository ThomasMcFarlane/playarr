import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiClient, ApiError } from "@playarr-tv/api-client";
import { ensureAccessToken } from "./session";
import { TokenStore } from "./tokenStore";

function mockFetch(handler: (request: Request) => Response | Promise<Response>) {
  return vi.fn(async (request: Request) => handler(request));
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const BASE_URL = "http://localhost:8484";
const IDENTITY = { deviceName: "Playarr Server Web", clientPlatform: "web" as const, clientVersion: "1.0.0" };

// Two distinct, UUID-shaped `peer_id`s -- the only shape
// `decodeAccessTokenIssuer`'s caller (`session.ts`'s
// `nodeScopedServerGroupCandidates`) treats as "this looks like a peer id,"
// mirroring the backend's own `Uuid::parse_str(&peeked.iss)` gate.
const PEER_HOME = "11111111-1111-4111-8111-111111111111";
const PEER_EAST = "22222222-2222-4222-8222-222222222222";

/**
 * Builds an unsigned, but structurally decodable, access token whose `iss`
 * claim is `iss` -- everything `decodeAccessTokenIssuer` (and, through it,
 * `ensureAccessToken`'s node-scoped refresh retry) ever reads. No signature
 * is written or checked here, matching `decodeAccessTokenIssuer`'s own "used
 * only as a routing hint, never a trust decision" doc comment.
 */
function accessTokenWithIssuer(iss: string): string {
  const payload = { sub: "00000000-0000-0000-0000-000000000009", iss };
  const base64 = btoa(JSON.stringify(payload)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `unused-header.${base64}.unused-signature`;
}

afterEach(() => {
  // See `tokenStore.test.ts`'s matching `afterEach` comment: the in-memory
  // fallback `TokenStore` falls back to is module-level, so it must be
  // reset explicitly between tests in this file.
  new TokenStore().clear();
  vi.unstubAllGlobals();
});

describe("ensureAccessToken", () => {
  it("calls POST /api/v1/auth/login when the store has no token yet, and persists the result", async () => {
    let loginCalls = 0;
    const client = new ApiClient({
      baseUrl: BASE_URL,
      fetchImpl: mockFetch(async (request) => {
        loginCalls += 1;
        expect(new URL(request.url).pathname).toBe("/api/v1/auth/login");
        const body = (await request.json()) as Record<string, unknown>;
        expect(body.device_name).toBe("Playarr Server Web");
        expect(body.client_platform).toBe("web");
        expect(body.client_version).toBe("1.0.0");
        expect(typeof body.device_id).toBe("string");
        return jsonResponse(200, {
          access_token: "at-1",
          refresh_token: "rt-1",
          token_type: "Bearer",
          expires_in: 3600,
          user_id: "00000000-0000-0000-0000-000000000009",
        });
      }),
    });
    const store = new TokenStore();

    const token = await ensureAccessToken(client, store, IDENTITY);

    expect(token).toBe("at-1");
    expect(loginCalls).toBe(1);
    expect(store.get()).toMatchObject({ accessToken: "at-1", refreshToken: "rt-1", tokenType: "Bearer" });
    expect(store.hasValidAccessToken()).toBe(true);
  });

  it("returns the existing token without calling login again when the store already holds a valid one", async () => {
    let loginCalls = 0;
    const client = new ApiClient({
      baseUrl: BASE_URL,
      fetchImpl: mockFetch(() => {
        loginCalls += 1;
        return jsonResponse(200, {
          access_token: "should-not-be-used",
          refresh_token: "rt",
          token_type: "Bearer",
          expires_in: 3600,
          user_id: "00000000-0000-0000-0000-000000000009",
        });
      }),
    });
    const store = new TokenStore();
    store.set({ accessToken: "already-here", refreshToken: "rt-0", tokenType: "Bearer", expiresAt: Date.now() + 5 * 60_000 });

    const token = await ensureAccessToken(client, store, IDENTITY);

    expect(token).toBe("already-here");
    expect(loginCalls).toBe(0);
  });

  it("refreshes before the access token can expire during a buffered media retry window", async () => {
    let refreshCalls = 0;
    const client = new ApiClient({
      baseUrl: BASE_URL,
      fetchImpl: mockFetch(async (request) => {
        refreshCalls += 1;
        expect(new URL(request.url).pathname).toBe("/api/v1/auth/refresh");
        return jsonResponse(200, {
          access_token: "playback-safe-token",
          refresh_token: "playback-safe-refresh",
          token_type: "Bearer",
          expires_in: 900,
          user_id: "00000000-0000-0000-0000-000000000009",
        });
      }),
    });
    const store = new TokenStore();
    store.set({
      accessToken: "nearly-expired",
      refreshToken: "refresh-before-playback",
      tokenType: "Bearer",
      expiresAt: Date.now() + 60_000,
    });

    await expect(ensureAccessToken(client, store, IDENTITY)).resolves.toBe(
      "playback-safe-token"
    );
    expect(refreshCalls).toBe(1);
  });

  it("forces a refresh after the server rejects an otherwise unexpired access token", async () => {
    const client = new ApiClient({
      baseUrl: BASE_URL,
      fetchImpl: mockFetch(() =>
        jsonResponse(200, {
          access_token: "recovered-token",
          refresh_token: "rotated-refresh-token",
          token_type: "Bearer",
          expires_in: 900,
          user_id: "00000000-0000-0000-0000-000000000009",
        })
      ),
    });
    const store = new TokenStore();
    store.set({
      accessToken: "server-rejected-token",
      refreshToken: "usable-refresh-token",
      tokenType: "Bearer",
      expiresAt: Date.now() + 10 * 60_000,
    });

    await expect(
      ensureAccessToken(client, store, IDENTITY, { forceRefresh: true })
    ).resolves.toBe("recovered-token");
  });

  it("makes concurrent media requests wait for a forced refresh instead of reusing the rejected token", async () => {
    let refreshCalls = 0;
    const client = new ApiClient({
      baseUrl: BASE_URL,
      fetchImpl: mockFetch(async () => {
        refreshCalls += 1;
        await new Promise((resolve) => setTimeout(resolve, 10));
        return jsonResponse(200, {
          access_token: "shared-recovered-token",
          refresh_token: "shared-rotated-refresh",
          token_type: "Bearer",
          expires_in: 900,
          user_id: "00000000-0000-0000-0000-000000000009",
        });
      }),
    });
    const store = new TokenStore();
    store.set({
      accessToken: "rejected-but-unexpired",
      refreshToken: "shared-refresh",
      tokenType: "Bearer",
      expiresAt: Date.now() + 10 * 60_000,
    });

    const forced = ensureAccessToken(client, store, IDENTITY, { forceRefresh: true });
    const concurrent = ensureAccessToken(client, store, IDENTITY);

    await expect(Promise.all([forced, concurrent])).resolves.toEqual([
      "shared-recovered-token",
      "shared-recovered-token",
    ]);
    expect(refreshCalls).toBe(1);
  });

  it("redeems the refresh token once a previously-stored access token has expired, without calling login", async () => {
    let refreshCalls = 0;
    let loginCalls = 0;
    const client = new ApiClient({
      baseUrl: BASE_URL,
      fetchImpl: mockFetch(async (request) => {
        const pathname = new URL(request.url).pathname;
        if (pathname === "/api/v1/auth/refresh") {
          refreshCalls += 1;
          const body = (await request.json()) as Record<string, unknown>;
          expect(body.refresh_token).toBe("rt-stale");
          expect(typeof body.device_id).toBe("string");
          return jsonResponse(200, {
            access_token: "fresh-token",
            refresh_token: "rt-fresh",
            token_type: "Bearer",
            expires_in: 3600,
            user_id: "00000000-0000-0000-0000-000000000009",
          });
        }
        loginCalls += 1;
        throw new Error(`unexpected request to ${pathname}`);
      }),
    });
    const store = new TokenStore();
    store.set({ accessToken: "stale", refreshToken: "rt-stale", tokenType: "Bearer", expiresAt: Date.now() - 1 });

    const token = await ensureAccessToken(client, store, IDENTITY);

    expect(token).toBe("fresh-token");
    expect(refreshCalls).toBe(1);
    expect(loginCalls).toBe(0);
    expect(store.get()).toMatchObject({ accessToken: "fresh-token", refreshToken: "rt-fresh" });
  });

  it("uses a profile-specific device id when refreshing an independently saved browser session", async () => {
    const profileDeviceId = "00000000-0000-4000-8000-000000000042";
    const client = new ApiClient({
      baseUrl: BASE_URL,
      fetchImpl: mockFetch(async (request) => {
        const body = (await request.json()) as Record<string, unknown>;
        expect(body.device_id).toBe(profileDeviceId);
        return jsonResponse(200, {
          access_token: "profile-token",
          refresh_token: "profile-refresh-next",
          token_type: "Bearer",
          expires_in: 3600,
          user_id: "00000000-0000-0000-0000-000000000009",
        });
      }),
    });
    const store = new TokenStore();
    store.set({
      accessToken: "expired-profile-token",
      refreshToken: "profile-refresh",
      tokenType: "Bearer",
      expiresAt: Date.now() - 1,
    });

    await ensureAccessToken(client, store, { ...IDENTITY, deviceId: profileDeviceId });
  });

  it("falls back to a transparent login when the stored refresh token itself no longer works", async () => {
    let refreshCalls = 0;
    let loginCalls = 0;
    const client = new ApiClient({
      baseUrl: BASE_URL,
      fetchImpl: mockFetch(async (request) => {
        const pathname = new URL(request.url).pathname;
        if (pathname === "/api/v1/auth/refresh") {
          refreshCalls += 1;
          return new Response(null, { status: 401, statusText: "unauthorized" });
        }
        loginCalls += 1;
        return jsonResponse(200, {
          access_token: "fresh-from-login",
          refresh_token: "rt-from-login",
          token_type: "Bearer",
          expires_in: 3600,
          user_id: "00000000-0000-0000-0000-000000000009",
        });
      }),
    });
    const store = new TokenStore();
    store.set({ accessToken: "stale", refreshToken: "dead-refresh-token", tokenType: "Bearer", expiresAt: Date.now() - 1 });

    const token = await ensureAccessToken(client, store, IDENTITY);

    expect(token).toBe("fresh-from-login");
    expect(refreshCalls).toBe(1);
    expect(loginCalls).toBe(1);
  });

  it("reuses a single in-flight login for concurrent callers instead of firing several", async () => {
    let loginCalls = 0;
    const client = new ApiClient({
      baseUrl: BASE_URL,
      fetchImpl: mockFetch(async () => {
        loginCalls += 1;
        await new Promise((resolve) => setTimeout(resolve, 10));
        return jsonResponse(200, {
          access_token: "at-concurrent",
          refresh_token: "rt-concurrent",
          token_type: "Bearer",
          expires_in: 3600,
          user_id: "00000000-0000-0000-0000-000000000009",
        });
      }),
    });
    const store = new TokenStore();

    const [a, b, c] = await Promise.all([
      ensureAccessToken(client, store, IDENTITY),
      ensureAccessToken(client, store, IDENTITY),
      ensureAccessToken(client, store, IDENTITY),
    ]);

    expect([a, b, c]).toEqual(["at-concurrent", "at-concurrent", "at-concurrent"]);
    expect(loginCalls).toBe(1);
  });

  it("propagates a login failure (e.g. untrusted_network) as a real ApiError instead of swallowing it", async () => {
    const client = new ApiClient({
      baseUrl: BASE_URL,
      fetchImpl: mockFetch(() => new Response(null, { status: 401, statusText: "untrusted_network" })),
    });
    const store = new TokenStore();

    await expect(ensureAccessToken(client, store, IDENTITY)).rejects.toBeInstanceOf(ApiError);
    expect(store.get()).toBeUndefined();
  });
});

// `docs/architecture/peer-groups.md` §7.2/§3.7: retry-before-reprompt.
// Every test above calls `ensureAccessToken` with the same 3-argument (or
// `forceRefresh`-only) shape existing callers already use -- proving those
// call sites are unaffected is the point of leaving them untouched here
// rather than retrofitting `serverGroup`/`clientForUrl` onto them.
//
// This fix's own bug report, restated as the three things this describe
// block has to prove:
//   (a) a refresh retry against a *different* node's address is skipped
//       entirely, not attempted -- only same-node alternates are tried;
//   (b) the fresh-login fallback genuinely tries multiple group addresses
//       when the first fails, succeeding on a later one;
//   (c) with no known peer group at all (a client that hasn't synced
//       anything yet), behavior is unchanged/inert -- a single refresh
//       attempt, then a single login attempt, exactly as with no
//       `serverGroup`/`clientForUrl` at all.
describe("ensureAccessToken with serverGroup/clientForUrl", () => {
  // (a)
  it("retries refresh only against same-node alternates -- a different node's address is never attempted", async () => {
    const homeUrl = "https://home.example.com";
    const homeAltUrl = "https://home-lan.example.com";
    const eastUrl = "https://east.example.com";
    let homeAltRefreshCalls = 0;
    let eastCalls = 0;

    const homeClient = new ApiClient({
      baseUrl: homeUrl,
      fetchImpl: mockFetch(() => {
        throw new TypeError("Failed to fetch");
      }),
    });
    const homeAltClient = new ApiClient({
      baseUrl: homeAltUrl,
      fetchImpl: mockFetch(async (request) => {
        homeAltRefreshCalls += 1;
        expect(new URL(request.url).pathname).toBe("/api/v1/auth/refresh");
        const body = (await request.json()) as Record<string, unknown>;
        expect(body.refresh_token).toBe("rt-stale");
        return jsonResponse(200, {
          access_token: "token-from-home-alt",
          refresh_token: "rt-rotated-by-home-alt",
          token_type: "Bearer",
          expires_in: 3600,
          user_id: "00000000-0000-0000-0000-000000000009",
        });
      }),
    });
    const eastClient = new ApiClient({
      baseUrl: eastUrl,
      fetchImpl: mockFetch(() => {
        eastCalls += 1;
        throw new Error("must never be reached -- east belongs to a different peer node");
      }),
    });

    const store = new TokenStore();
    store.set({
      accessToken: accessTokenWithIssuer(PEER_HOME),
      refreshToken: "rt-stale",
      tokenType: "Bearer",
      expiresAt: Date.now() - 1,
    });

    const token = await ensureAccessToken(homeClient, store, IDENTITY, {
      serverGroup: {
        servers: [
          { url: homeUrl, peerNodeId: PEER_HOME },
          { url: homeAltUrl, peerNodeId: PEER_HOME },
          { url: eastUrl, peerNodeId: PEER_EAST },
        ],
      },
      clientForUrl: (url) => (url === homeAltUrl ? homeAltClient : url === eastUrl ? eastClient : homeClient),
    });

    expect(token).toBe("token-from-home-alt");
    expect(homeAltRefreshCalls).toBe(1);
    expect(eastCalls).toBe(0);
    expect(store.get()).toMatchObject({ accessToken: "token-from-home-alt", refreshToken: "rt-rotated-by-home-alt" });
  });

  // (a), the standalone/HS256 half: an `iss` that isn't peer-id-shaped at
  // all disables the retry outright, even though the group has real,
  // attributed addresses that would otherwise be candidates.
  it("does not attempt the refresh-across-group retry at all when iss isn't peer-id-shaped", async () => {
    const homeUrl = "https://home.example.com";
    const eastUrl = "https://east.example.com";
    let refreshAttempts = 0;

    const homeClient = new ApiClient({
      baseUrl: homeUrl,
      fetchImpl: mockFetch((request) => {
        const pathname = new URL(request.url).pathname;
        if (pathname === "/api/v1/auth/refresh") {
          refreshAttempts += 1;
          throw new TypeError("Failed to fetch");
        }
        return jsonResponse(200, {
          access_token: "token-from-home-login",
          refresh_token: "rt-from-home-login",
          token_type: "Bearer",
          expires_in: 3600,
          user_id: "00000000-0000-0000-0000-000000000009",
        });
      }),
    });
    const eastClient = new ApiClient({
      baseUrl: eastUrl,
      fetchImpl: mockFetch(() => {
        throw new Error("must never be reached -- the retry should never fire at all");
      }),
    });

    const store = new TokenStore();
    store.set({
      // The fixed HS256 issuer string a standalone (or not-yet-cross-node-
      // trusted) node issues -- `playarr_auth::jwt::JwtIssuer`'s default,
      // not a `peer_id`.
      accessToken: accessTokenWithIssuer("playarr"),
      refreshToken: "rt-stale",
      tokenType: "Bearer",
      expiresAt: Date.now() - 1,
    });

    const token = await ensureAccessToken(homeClient, store, IDENTITY, {
      serverGroup: {
        servers: [
          { url: homeUrl, peerNodeId: PEER_HOME },
          { url: eastUrl, peerNodeId: PEER_EAST },
        ],
      },
      clientForUrl: (url) => (url === eastUrl ? eastClient : homeClient),
    });

    expect(token).toBe("token-from-home-login");
    // Exactly the one direct attempt against `client` -- the group-wide
    // retry step never runs at all.
    expect(refreshAttempts).toBe(1);
  });

  it("tries lastGoodUrl before servers[] during the node-scoped refresh retry", async () => {
    const homeUrl = "https://home.example.com";
    const homeAltUrl = "https://home-lan.example.com";
    const eastUrl = "https://east.example.com";
    const refreshTried: string[] = [];
    let eastCalls = 0;

    // Every same-node candidate's refresh fails; anything that isn't a
    // refresh call (i.e. the eventual login fallback) succeeds -- isolates
    // candidate *order* from the unrelated "which address serves the final
    // login" question the next tests cover.
    const homeFamilyClientFor = (url: string) =>
      new ApiClient({
        baseUrl: url,
        fetchImpl: mockFetch((request) => {
          if (new URL(request.url).pathname !== "/api/v1/auth/refresh") {
            return jsonResponse(200, {
              access_token: "fallback-login-token",
              refresh_token: "fallback-login-refresh",
              token_type: "Bearer",
              expires_in: 3600,
              user_id: "00000000-0000-0000-0000-000000000009",
            });
          }
          refreshTried.push(url);
          throw new TypeError("Failed to fetch");
        }),
      });
    const eastClient = new ApiClient({
      baseUrl: eastUrl,
      fetchImpl: mockFetch(() => {
        eastCalls += 1;
        throw new Error("must never be reached -- east belongs to a different peer node");
      }),
    });
    const store = new TokenStore();
    store.set({
      accessToken: accessTokenWithIssuer(PEER_HOME),
      refreshToken: "rt-stale",
      tokenType: "Bearer",
      expiresAt: Date.now() - 1,
    });
    const primaryClient = homeFamilyClientFor(homeUrl);

    const token = await ensureAccessToken(primaryClient, store, IDENTITY, {
      serverGroup: {
        servers: [
          { url: homeUrl, peerNodeId: PEER_HOME },
          { url: homeAltUrl, peerNodeId: PEER_HOME },
          { url: eastUrl, peerNodeId: PEER_EAST },
        ],
        lastGoodUrl: homeAltUrl,
      },
      clientForUrl: (url) => (url === eastUrl ? eastClient : homeFamilyClientFor(url)),
    });

    expect(token).toBe("fallback-login-token");
    expect(refreshTried).toEqual([
      homeUrl, // `client` itself, tried first, same as always
      homeAltUrl, // lastGoodUrl -- tried before servers[], since it's home-owned
      homeUrl, // servers[] walk (home-owned; homeAltUrl already tried is de-duped)
    ]);
    expect(eastCalls).toBe(0);
  });

  it("retries refresh across every same-node address before falling through to login, once all of them fail", async () => {
    let refreshAttempts = 0;
    let loginCalls = 0;
    const homeFamilyClientFor = (url: string) =>
      new ApiClient({
        baseUrl: url,
        fetchImpl: mockFetch((request) => {
          const pathname = new URL(request.url).pathname;
          if (pathname === "/api/v1/auth/refresh") {
            refreshAttempts += 1;
            throw new TypeError("Failed to fetch");
          }
          loginCalls += 1;
          return jsonResponse(200, {
            access_token: "token-from-fresh-login",
            refresh_token: "rt-from-fresh-login",
            token_type: "Bearer",
            expires_in: 3600,
            user_id: "00000000-0000-0000-0000-000000000009",
          });
        }),
      });
    const store = new TokenStore();
    store.set({
      accessToken: accessTokenWithIssuer(PEER_HOME),
      refreshToken: "rt-stale",
      tokenType: "Bearer",
      expiresAt: Date.now() - 1,
    });
    const primaryClient = homeFamilyClientFor("https://home.example.com");

    const token = await ensureAccessToken(primaryClient, store, IDENTITY, {
      serverGroup: {
        servers: [
          { url: "https://home.example.com", peerNodeId: PEER_HOME },
          { url: "https://home-lan.example.com", peerNodeId: PEER_HOME },
        ],
      },
      clientForUrl: homeFamilyClientFor,
    });

    expect(token).toBe("token-from-fresh-login");
    // `client` directly (home) + the node-scoped retry's own walk (home
    // again, then home-lan) -- both addresses genuinely belong to the same
    // peer that issued the stored access token, so both are worth trying.
    expect(refreshAttempts).toBe(3);
    expect(loginCalls).toBe(1);
  });

  // (b)
  it("retries a fresh login across every remembered group address, succeeding on a later one", async () => {
    const homeUrl = "https://home.example.com";
    const eastUrl = "https://east.example.com";
    const westUrl = "https://west.example.com";
    const loginAttempts: string[] = [];

    const clientFor = (url: string) =>
      new ApiClient({
        baseUrl: url,
        fetchImpl: mockFetch((request) => {
          const pathname = new URL(request.url).pathname;
          if (pathname === "/api/v1/auth/refresh") {
            throw new TypeError("Failed to fetch");
          }
          loginAttempts.push(url);
          if (url === westUrl) {
            return jsonResponse(200, {
              access_token: "token-from-west-login",
              refresh_token: "rt-from-west-login",
              token_type: "Bearer",
              expires_in: 3600,
              user_id: "00000000-0000-0000-0000-000000000009",
            });
          }
          throw new TypeError("Failed to fetch");
        }),
      });

    const store = new TokenStore();
    // No attribution at all -- irrelevant here, since the login fallback is
    // deliberately never node-scoped (unlike refresh).
    store.set({ accessToken: "stale", refreshToken: "rt-stale", tokenType: "Bearer", expiresAt: Date.now() - 1 });
    const homeClient = clientFor(homeUrl);

    const token = await ensureAccessToken(homeClient, store, IDENTITY, {
      serverGroup: { servers: [{ url: homeUrl }, { url: eastUrl }, { url: westUrl }] },
      clientForUrl: clientFor,
    });

    expect(token).toBe("token-from-west-login");
    // `client` itself (home) is tried directly first, same as always; once
    // that fails too, the group-wide login fallback walks its own
    // candidate list from the top -- home fails again, then east, before
    // west finally succeeds.
    expect(loginAttempts).toEqual([homeUrl, homeUrl, eastUrl, westUrl]);
    expect(store.get()).toMatchObject({ accessToken: "token-from-west-login", refreshToken: "rt-from-west-login" });
  });

  // (c)
  it("is unaffected when only one of serverGroup/clientForUrl is supplied -- both are required together", async () => {
    let refreshCalls = 0;
    let loginCalls = 0;
    const client = new ApiClient({
      baseUrl: BASE_URL,
      fetchImpl: mockFetch((request) => {
        const pathname = new URL(request.url).pathname;
        if (pathname === "/api/v1/auth/refresh") {
          refreshCalls += 1;
          throw new TypeError("Failed to fetch");
        }
        loginCalls += 1;
        return jsonResponse(200, {
          access_token: "solo-login-token",
          refresh_token: "solo-login-refresh",
          token_type: "Bearer",
          expires_in: 3600,
          user_id: "00000000-0000-0000-0000-000000000009",
        });
      }),
    });
    const store = new TokenStore();
    store.set({ accessToken: "stale", refreshToken: "rt-stale", tokenType: "Bearer", expiresAt: Date.now() - 1 });

    const token = await ensureAccessToken(client, store, IDENTITY, {
      serverGroup: { servers: [{ url: "https://east.example.com" }] },
      // clientForUrl deliberately omitted.
    });

    expect(token).toBe("solo-login-token");
    expect(refreshCalls).toBe(1);
    expect(loginCalls).toBe(1);
  });

  // The exact shape `ApiClientProvider.tsx`'s real call sites pass for a
  // client that has never remembered a `KnownServerGroup`:
  // `serverGroup: readKnownServers()` (`undefined`) alongside a real,
  // always-supplied `clientForUrl`. Proves that pairing is just as inert
  // as omitting both -- the rollout invariant holds for the *actual*
  // shape production code sends, not just the "omitted entirely" shape
  // the very first tests in this file already cover.
  it("is unaffected when serverGroup is explicitly undefined, even with a real clientForUrl supplied", async () => {
    let refreshCalls = 0;
    let loginCalls = 0;
    let clientForUrlCalls = 0;
    const client = new ApiClient({
      baseUrl: BASE_URL,
      fetchImpl: mockFetch((request) => {
        const pathname = new URL(request.url).pathname;
        if (pathname === "/api/v1/auth/refresh") {
          refreshCalls += 1;
          throw new TypeError("Failed to fetch");
        }
        loginCalls += 1;
        return jsonResponse(200, {
          access_token: "solo-login-token-2",
          refresh_token: "solo-login-refresh-2",
          token_type: "Bearer",
          expires_in: 3600,
          user_id: "00000000-0000-0000-0000-000000000009",
        });
      }),
    });
    const store = new TokenStore();
    store.set({ accessToken: "stale", refreshToken: "rt-stale", tokenType: "Bearer", expiresAt: Date.now() - 1 });

    const token = await ensureAccessToken(client, store, IDENTITY, {
      serverGroup: undefined,
      clientForUrl: () => {
        clientForUrlCalls += 1;
        throw new Error("must never be called when serverGroup is undefined");
      },
    });

    expect(token).toBe("solo-login-token-2");
    expect(refreshCalls).toBe(1);
    expect(loginCalls).toBe(1);
    expect(clientForUrlCalls).toBe(0);
  });

  // (c), the "remembered a group, but no address carries node attribution
  // yet" shape -- e.g. a `KnownServerGroup` written before this fix shipped.
  // The refresh-across-group step is inert here too (nothing to scope
  // against), exactly like having no group at all -- but the *login*
  // fallback below is a different feature with a different rule (never
  // node-scoped, §3.7), so it still fires and can still recover the
  // session. Proves the two retries are independently gated, not one
  // all-or-nothing "group known" switch.
  it("leaves the refresh retry inert with no peerNodeId attribution anywhere, while the login fallback still spans the group", async () => {
    let refreshAttempts = 0;
    const homeUrl = "https://home.example.com";
    const eastUrl = "https://east.example.com";
    const clientFor = (url: string) =>
      new ApiClient({
        baseUrl: url,
        fetchImpl: mockFetch((request) => {
          const pathname = new URL(request.url).pathname;
          if (pathname === "/api/v1/auth/refresh") {
            refreshAttempts += 1;
            throw new TypeError("Failed to fetch");
          }
          if (url === eastUrl) {
            return jsonResponse(200, {
              access_token: "token-from-east-login",
              refresh_token: "rt-from-east-login",
              token_type: "Bearer",
              expires_in: 3600,
              user_id: "00000000-0000-0000-0000-000000000009",
            });
          }
          throw new TypeError("Failed to fetch");
        }),
      });
    const store = new TokenStore();
    store.set({
      // A real, peer-id-shaped issuer -- but no `servers[]` entry below
      // carries a matching (or any) `peerNodeId`, so there is nothing for
      // the refresh retry to match against.
      accessToken: accessTokenWithIssuer(PEER_HOME),
      refreshToken: "rt-stale",
      tokenType: "Bearer",
      expiresAt: Date.now() - 1,
    });
    const homeClient = clientFor(homeUrl);

    const token = await ensureAccessToken(homeClient, store, IDENTITY, {
      serverGroup: { servers: [{ url: homeUrl }, { url: eastUrl }] },
      clientForUrl: clientFor,
    });

    expect(token).toBe("token-from-east-login");
    // Exactly one refresh attempt (the direct one) -- no unattributed
    // address is ever retried for refresh.
    expect(refreshAttempts).toBe(1);
  });
});
