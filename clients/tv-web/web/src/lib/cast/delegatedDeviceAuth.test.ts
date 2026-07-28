import { describe, expect, it, vi } from "vitest";
import type { CastAuthStorage } from "./delegatedDeviceAuth";
import {
  clearDelegatedCastCredentials,
  ensureDelegatedCastCredentials,
  persistRotatedDelegatedCastCredentials,
} from "./delegatedDeviceAuth";

const BASE_URL = "http://localhost:8484";
const STORAGE_KEY = "playarr.cast.delegated.v1";

function memoryStorage(initial: Record<string, string> = {}): CastAuthStorage {
  const store = new Map(Object.entries(initial));
  return {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => {
      store.set(key, value);
    },
    removeItem: (key) => {
      store.delete(key);
    },
  };
}

function fakeAccessToken(claims: Record<string, unknown>): string {
  const header = btoa(JSON.stringify({ alg: "none", typ: "JWT" }));
  const payload = btoa(JSON.stringify(claims));
  return `${header}.${payload}.signature`;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function pathOf(request: Request): string {
  return new URL(request.url).pathname;
}

describe("ensureDelegatedCastCredentials", () => {
  it("mints a brand-new delegated device identity when nothing is cached", async () => {
    const castAccessToken = fakeAccessToken({ device_id: "cast-device-1", sub: "user-1" });
    const authorizeCalls: Request[] = [];

    const fetchImpl = vi.fn(async (request: Request) => {
      const path = pathOf(request);
      if (path === "/api/v1/oauth/device/code") {
        expect(request.method).toBe("POST");
        expect(await request.json()).toEqual({ client_platform: "cast" });
        return jsonResponse(200, {
          device_code: "dc-1",
          user_code: "USER-CODE",
          verification_uri: "https://playarr.example/link",
          verification_uri_complete: "https://playarr.example/link?code=USER-CODE",
          expires_in: 600,
          interval: 5,
        });
      }
      if (path === "/api/v1/oauth/device/authorize") {
        authorizeCalls.push(request);
        expect(await request.json()).toEqual({ user_code: "USER-CODE" });
        return new Response(null, { status: 204 });
      }
      if (path === "/api/v1/oauth/token") {
        expect(await request.json()).toEqual({
          grant_type: "urn:ietf:params:oauth:grant-type:device_code",
          device_code: "dc-1",
        });
        return jsonResponse(200, {
          access_token: castAccessToken,
          refresh_token: "cast-refresh-1",
          token_type: "Bearer",
          expires_in: 900,
        });
      }
      throw new Error(`Unexpected request to ${path}`);
    });

    const storage = memoryStorage();
    const credentials = await ensureDelegatedCastCredentials({
      apiBaseUrl: BASE_URL,
      fetchImpl,
      getSenderAccessToken: () => "sender-access-token",
      storage,
    });

    expect(credentials).toEqual({
      deviceId: "cast-device-1",
      accessToken: castAccessToken,
      accessTokenExpiresAt: expect.any(Number),
      refreshToken: "cast-refresh-1",
    });

    // The self-approval call carries the SENDER's own bearer token -- it is
    // a protected operation, never the receiver-bound credential.
    expect(authorizeCalls).toHaveLength(1);
    expect(authorizeCalls[0]?.headers.get("authorization")).toBe("Bearer sender-access-token");

    // Only {apiBaseUrl, castDeviceId, castRefreshToken} are cached -- never
    // the access token itself.
    const stored = JSON.parse(storage.getItem(STORAGE_KEY) ?? "{}") as Record<string, unknown>;
    expect(stored).toEqual({
      apiBaseUrl: BASE_URL,
      castDeviceId: "cast-device-1",
      castRefreshToken: "cast-refresh-1",
    });
  });

  it("reuses a cached device identity via a single refresh call, without re-minting", async () => {
    const storage = memoryStorage({
      [STORAGE_KEY]: JSON.stringify({
        apiBaseUrl: BASE_URL,
        castDeviceId: "cast-device-cached",
        castRefreshToken: "cast-refresh-old",
      }),
    });

    const fetchImpl = vi.fn(async (request: Request) => {
      const path = pathOf(request);
      if (path === "/api/v1/auth/refresh") {
        expect(await request.json()).toEqual({
          device_id: "cast-device-cached",
          refresh_token: "cast-refresh-old",
        });
        return jsonResponse(200, {
          access_token: "cast-access-refreshed",
          refresh_token: "cast-refresh-new",
          token_type: "Bearer",
          expires_in: 900,
        });
      }
      throw new Error(`Unexpected request to ${path} -- the device-code mint flow must not run`);
    });

    const credentials = await ensureDelegatedCastCredentials({
      apiBaseUrl: BASE_URL,
      fetchImpl,
      getSenderAccessToken: () => "sender-access-token",
      storage,
    });

    expect(credentials).toEqual({
      deviceId: "cast-device-cached",
      accessToken: "cast-access-refreshed",
      accessTokenExpiresAt: expect.any(Number),
      refreshToken: "cast-refresh-new",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    const stored = JSON.parse(storage.getItem(STORAGE_KEY) ?? "{}") as Record<string, unknown>;
    expect(stored).toEqual({
      apiBaseUrl: BASE_URL,
      castDeviceId: "cast-device-cached",
      castRefreshToken: "cast-refresh-new",
    });
  });

  it("ignores a cached identity minted against a different server", async () => {
    const storage = memoryStorage({
      [STORAGE_KEY]: JSON.stringify({
        apiBaseUrl: "http://a-different-server:8484",
        castDeviceId: "cast-device-elsewhere",
        castRefreshToken: "cast-refresh-elsewhere",
      }),
    });
    const castAccessToken = fakeAccessToken({ device_id: "cast-device-fresh" });

    const fetchImpl = vi.fn(async (request: Request) => {
      const path = pathOf(request);
      if (path === "/api/v1/oauth/device/code") {
        return jsonResponse(200, {
          device_code: "dc-2",
          user_code: "CODE-2",
          verification_uri: "v",
          verification_uri_complete: "v",
          expires_in: 600,
          interval: 5,
        });
      }
      if (path === "/api/v1/oauth/device/authorize") return new Response(null, { status: 204 });
      if (path === "/api/v1/oauth/token") {
        return jsonResponse(200, {
          access_token: castAccessToken,
          refresh_token: "cast-refresh-fresh",
          token_type: "Bearer",
          expires_in: 900,
        });
      }
      throw new Error(`Unexpected request to ${path}`);
    });

    const credentials = await ensureDelegatedCastCredentials({
      apiBaseUrl: BASE_URL,
      fetchImpl,
      getSenderAccessToken: () => "sender-access-token",
      storage,
    });

    expect(credentials.deviceId).toBe("cast-device-fresh");
  });

  it("falls through to minting a fresh identity when the cached refresh token is dead", async () => {
    const storage = memoryStorage({
      [STORAGE_KEY]: JSON.stringify({
        apiBaseUrl: BASE_URL,
        castDeviceId: "cast-device-dead",
        castRefreshToken: "cast-refresh-dead",
      }),
    });
    const castAccessToken = fakeAccessToken({ device_id: "cast-device-reminted" });

    const fetchImpl = vi.fn(async (request: Request) => {
      const path = pathOf(request);
      if (path === "/api/v1/auth/refresh") {
        return new Response(null, { status: 401, statusText: "Unauthorized" });
      }
      if (path === "/api/v1/oauth/device/code") {
        return jsonResponse(200, {
          device_code: "dc-3",
          user_code: "CODE-3",
          verification_uri: "v",
          verification_uri_complete: "v",
          expires_in: 600,
          interval: 5,
        });
      }
      if (path === "/api/v1/oauth/device/authorize") return new Response(null, { status: 204 });
      if (path === "/api/v1/oauth/token") {
        return jsonResponse(200, {
          access_token: castAccessToken,
          refresh_token: "cast-refresh-reminted",
          token_type: "Bearer",
          expires_in: 900,
        });
      }
      throw new Error(`Unexpected request to ${path}`);
    });

    const credentials = await ensureDelegatedCastCredentials({
      apiBaseUrl: BASE_URL,
      fetchImpl,
      getSenderAccessToken: () => "sender-access-token",
      storage,
    });

    expect(credentials.deviceId).toBe("cast-device-reminted");
    expect(credentials.refreshToken).toBe("cast-refresh-reminted");
  });

  it("throws when the minted access token carries no device_id claim", async () => {
    const tokenWithoutDeviceId = fakeAccessToken({ sub: "user-1" });
    const fetchImpl = vi.fn(async (request: Request) => {
      const path = pathOf(request);
      if (path === "/api/v1/oauth/device/code") {
        return jsonResponse(200, {
          device_code: "dc-4",
          user_code: "CODE-4",
          verification_uri: "v",
          verification_uri_complete: "v",
          expires_in: 600,
          interval: 5,
        });
      }
      if (path === "/api/v1/oauth/device/authorize") return new Response(null, { status: 204 });
      if (path === "/api/v1/oauth/token") {
        return jsonResponse(200, {
          access_token: tokenWithoutDeviceId,
          refresh_token: "rt",
          token_type: "Bearer",
          expires_in: 900,
        });
      }
      throw new Error(`Unexpected request to ${path}`);
    });

    await expect(
      ensureDelegatedCastCredentials({
        apiBaseUrl: BASE_URL,
        fetchImpl,
        getSenderAccessToken: () => "sender-access-token",
        storage: memoryStorage(),
      })
    ).rejects.toThrow(/device_id/);
  });
});

describe("persistRotatedDelegatedCastCredentials", () => {
  it("overwrites the cached refresh token under the same storage key", () => {
    const storage = memoryStorage();
    persistRotatedDelegatedCastCredentials(
      BASE_URL,
      { deviceId: "cast-device-1", refreshToken: "rotated-refresh-token" },
      storage
    );

    const stored = JSON.parse(storage.getItem(STORAGE_KEY) ?? "{}") as Record<string, unknown>;
    expect(stored).toEqual({
      apiBaseUrl: BASE_URL,
      castDeviceId: "cast-device-1",
      castRefreshToken: "rotated-refresh-token",
    });
  });
});

describe("clearDelegatedCastCredentials", () => {
  it("removes any cached identity", () => {
    const storage = memoryStorage({ [STORAGE_KEY]: "{}" });
    clearDelegatedCastCredentials(storage);
    expect(storage.getItem(STORAGE_KEY)).toBeNull();
  });
});
