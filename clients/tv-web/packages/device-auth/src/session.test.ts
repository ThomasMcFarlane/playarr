import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiClient, ApiError } from "@streamarr-tv/api-client";
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

const BASE_URL = "http://localhost:8080";
const IDENTITY = { deviceName: "Streamarr Web", clientPlatform: "web" as const, clientVersion: "1.0.0" };

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
        expect(body.device_name).toBe("Streamarr Web");
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
    store.set({ accessToken: "already-here", refreshToken: "rt-0", tokenType: "Bearer", expiresAt: Date.now() + 60_000 });

    const token = await ensureAccessToken(client, store, IDENTITY);

    expect(token).toBe("already-here");
    expect(loginCalls).toBe(0);
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
