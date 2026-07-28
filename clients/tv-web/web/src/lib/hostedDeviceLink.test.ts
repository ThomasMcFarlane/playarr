import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApiClient } from "@streamarr-tv/api-client";
import {
  authoriseHostedLink,
  inspectHostedLink,
  pollHostedDeviceLink,
  requestHostedDeviceLink,
  shouldUseHostedDeviceLink,
} from "./hostedDeviceLink";

afterEach(() => vi.unstubAllGlobals());

describe("hosted device linking", () => {
  it("keeps an operator-configured packaged TV on direct server linking", () => {
    expect(shouldUseHostedDeviceLink(true)).toBe(true);
    expect(shouldUseHostedDeviceLink(true, "  ")).toBe(true);
    expect(shouldUseHostedDeviceLink(true, "https://streamarr.example.test")).toBe(false);
    expect(shouldUseHostedDeviceLink(false)).toBe(false);
  });

  it("uses the same hosted first-contact flow for VIDAA as packaged TVs", () => {
    expect(shouldUseHostedDeviceLink(false, undefined, "tv-vidaa")).toBe(true);
    expect(
      shouldUseHostedDeviceLink(false, "https://streamarr.example.test", "tv-vidaa")
    ).toBe(false);
  });

  it.each(["tv-webos", "tv-tizen", "tv-vidaa", "tv-fire"] as const)(
    "requests a first-contact code for packaged %s clients",
    async (clientPlatform) => {
      const fetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(
          JSON.stringify({
            device_code: "hosted-secret",
            user_code: "ABCD-2345",
            verification_uri: "https://playarr.app/link",
            verification_uri_complete: "https://playarr.app/link?user_code=ABCD-2345",
            expires_in: 600,
            interval: 2,
          }),
          { status: 200 }
        )
      );

      const code = await requestHostedDeviceLink(clientPlatform, {
        fetchImpl: fetch as typeof globalThis.fetch,
        now: () => 1_000,
      });

      expect(code).toMatchObject({
        deviceCode: "hosted-secret",
        userCode: "ABCD-2345",
        expiresAt: 601_000,
      });
      const requestInit = fetch.mock.calls[0]?.[1] as RequestInit | undefined;
      expect(JSON.parse(String(requestInit?.body))).toEqual({
        client_platform: clientPlatform,
      });
    }
  );

  it("polls the hosted broker until it returns the selected Streamarr server", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "authorization_pending" }), { status: 202 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            user_code: "ABCD-2345",
            server_url: "http://streamarr.lan:8484",
            server_device_code: "server-device-secret",
            server_urls: ["http://streamarr.lan:8484"],
          }),
          { status: 200 }
        )
      );
    const wait = vi.fn(async () => undefined);

    await expect(
      pollHostedDeviceLink(
        {
          deviceCode: "hosted-secret",
          userCode: "ABCD-2345",
          verificationUri: "https://playarr.app/link",
          verificationUriComplete: "https://playarr.app/link?user_code=ABCD-2345",
          expiresInSeconds: 600,
          intervalSeconds: 2,
          expiresAt: 601_000,
        },
        {
          fetchImpl: fetch as typeof globalThis.fetch,
          now: () => 1_000,
          wait,
        }
      )
    ).resolves.toMatchObject({
      server_url: "http://streamarr.lan:8484",
      server_device_code: "server-device-secret",
    });
    expect(wait).toHaveBeenCalledTimes(2);
  });

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
    const requestInit = fetch.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(JSON.parse(String(requestInit?.body))).toEqual({
      user_code: "ABCD-2345",
      server_url: "http://streamarr.lan:8484",
      server_device_code: "server-device-secret",
      server_urls: ["http://streamarr.lan:8484"],
    });
  });

  it("sends expired packaged-TV links back to the TV for a fresh code", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 404 })));
    const client = {
      requestDeviceCode: vi.fn(async () => ({
        device_code: "server-device-secret",
        user_code: "WXYZ-6789",
        verification_uri: "https://playarr.app/link",
        verification_uri_complete: "https://playarr.app/link?user_code=WXYZ-6789",
        expires_in: 600,
        interval: 5,
      })),
      authorizeDevice: vi.fn(async () => undefined),
    } as unknown as ApiClient;

    await expect(
      authoriseHostedLink({
        userCode: "ABCD-2345",
        session: { client_platform: "tv-tizen", expires_at: Date.now() + 60_000, linked: false },
        serverUrl: "http://streamarr.lan:8484",
        client,
      })
    ).rejects.toThrow("That Playarr link code has expired. Generate a new code on the TV.");
  });
});
