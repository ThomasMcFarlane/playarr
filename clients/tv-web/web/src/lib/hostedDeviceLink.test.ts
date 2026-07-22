import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApiClient } from "@streamarr-tv/api-client";
import { authoriseHostedLink, inspectHostedLink } from "./hostedDeviceLink";

afterEach(() => vi.unstubAllGlobals());

describe("hosted device linking", () => {
  it("distinguishes hosted codes from legacy per-server codes", async () => {
    const fetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(null, { status: 404 })
    );
    vi.stubGlobal("fetch", fetch);

    await expect(inspectHostedLink("ABCD-2345")).resolves.toBeNull();
    expect(fetch).toHaveBeenCalledWith(
      "/api/link/session?user_code=ABCD-2345",
      expect.objectContaining({ headers: { Accept: "application/json" } })
    );
  });

  it("creates and approves the real Streamarr device code before claiming the hosted code", async () => {
    const fetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify({ linked: true }), { status: 200 })
    );
    vi.stubGlobal("fetch", fetch);
    const requestDeviceCode = vi.fn(async () => ({
      device_code: "server-device-secret",
      user_code: "WXYZ-6789",
      verification_uri: "https://playarr.app/link",
      verification_uri_complete: "https://playarr.app/link?user_code=WXYZ-6789",
      expires_in: 600,
      interval: 5,
    }));
    const authorizeDevice = vi.fn(async () => undefined);
    const client = { requestDeviceCode, authorizeDevice } as unknown as ApiClient;

    await authoriseHostedLink({
      userCode: "ABCD-2345",
      session: { client_platform: "android-tv", expires_at: Date.now() + 60_000, linked: false },
      serverUrl: "http://streamarr.lan:8484",
      client,
    });

    expect(requestDeviceCode).toHaveBeenCalledWith({ client_platform: "android-tv" });
    expect(authorizeDevice).toHaveBeenCalledWith({ user_code: "WXYZ-6789" });
    expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toEqual({
      user_code: "ABCD-2345",
      server_url: "http://streamarr.lan:8484",
      server_device_code: "server-device-secret",
      server_urls: ["http://streamarr.lan:8484"],
    });
  });
});
