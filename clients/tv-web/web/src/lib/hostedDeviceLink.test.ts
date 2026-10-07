import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApiClient } from "@playarr-tv/api-client";
import {
  authoriseHostedLink,
  inspectHostedLink,
  pollHostedDeviceLink,
  requestHostedDeviceLink,
  hostedLinkApiBase,
  shouldUseHostedDeviceLink,
} from "./hostedDeviceLink";

afterEach(() => vi.unstubAllGlobals());

describe("hostedLinkApiBase", () => {
  it("is same-origin on playarr.app and absolute from the server-hosted client", () => {
    expect(hostedLinkApiBase("production")).toBe("");
    expect(hostedLinkApiBase("server")).toBe("https://playarr.app");
  });
});

describe("hosted device linking", () => {
  it("keeps an operator-configured packaged TV on direct server linking", () => {
    expect(shouldUseHostedDeviceLink(true)).toBe(true);
    expect(shouldUseHostedDeviceLink(true, "  ")).toBe(true);
    expect(shouldUseHostedDeviceLink(true, "https://playarr.example.test")).toBe(false);
    expect(shouldUseHostedDeviceLink(false)).toBe(false);
  });

  it("uses the same hosted first-contact flow for VIDAA as packaged TVs", () => {
    expect(shouldUseHostedDeviceLink(false, undefined, "tv-vidaa")).toBe(true);
    expect(
      shouldUseHostedDeviceLink(false, "https://playarr.example.test", "tv-vidaa")
    ).toBe(false);
  });

  it("uses the same hosted first-contact flow for Xbox's Edge browser as packaged TVs", () => {
    expect(shouldUseHostedDeviceLink(false, undefined, "xbox")).toBe(true);
    expect(
      shouldUseHostedDeviceLink(false, "https://playarr.example.test", "xbox")
    ).toBe(false);
  });

  it.each([
    "web",
    "android-mobile",
    "android-tv",
    "tv-webos",
    "tv-tizen",
    "tv-vidaa",
    "tv-fire",
    "xbox",
  ] as const)(
    "requests a brokered first-contact code for %s clients",
    async (clientPlatform) => {
      const fetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(
          JSON.stringify({
            device_code: "hosted-secret",
            user_code: "ABCD-2345",
            verification_uri: "https://playarr.app/link",
            verification_uri_complete: "https://playarr.app/link?user_code=ABCD-2345",
            expires_in: 300,
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
        expiresAt: 301_000,
      });
      const requestInit = fetch.mock.calls[0]?.[1] as RequestInit | undefined;
      expect(JSON.parse(String(requestInit?.body))).toEqual({
        client_platform: clientPlatform,
      });
    }
  );

  it("polls the hosted broker until it returns the selected Playarr Server", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "authorization_pending" }), { status: 202 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            user_code: "ABCD-2345",
            server_url: "http://playarr.lan:8484",
            server_device_code: "server-device-secret",
            server_urls: ["http://playarr.lan:8484"],
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
          expiresInSeconds: 300,
          intervalSeconds: 2,
          expiresAt: 301_000,
        },
        {
          fetchImpl: fetch as typeof globalThis.fetch,
          now: () => 1_000,
          wait,
        }
      )
    ).resolves.toMatchObject({
      server_url: "http://playarr.lan:8484",
      server_device_code: "server-device-secret",
    });
    expect(wait).toHaveBeenCalledTimes(2);
  });

  it("makes one final claim-collection request when its wait crosses expiry", async () => {
    let now = 1_000;
    const fetch = vi.fn(async () =>
      new Response(JSON.stringify({ error: "authorization_pending" }), {
        status: 202,
      })
    );
    const wait = vi.fn(async () => {
      now = 2_001;
    });

    await expect(
      pollHostedDeviceLink(
        {
          deviceCode: "hosted-secret",
          userCode: "ABCD-2345",
          verificationUri: "https://playarr.app/link",
          verificationUriComplete:
            "https://playarr.app/link?user_code=ABCD-2345",
          expiresInSeconds: 1,
          intervalSeconds: 2,
          expiresAt: 2_000,
        },
        {
          fetchImpl: fetch as typeof globalThis.fetch,
          now: () => now,
          wait,
        }
      )
    ).rejects.toThrow(/expired/i);

    expect(wait).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("collects a claim when a pre-expiry pending response crosses the deadline", async () => {
    let now = 1_000;
    const fetch = vi
      .fn()
      .mockImplementationOnce(async () => {
        now = 2_001;
        return new Response(
          JSON.stringify({ error: "authorization_pending" }),
          { status: 202 }
        );
      })
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            user_code: "ABCD-2345",
            server_url: "http://playarr.lan:8484",
            server_device_code: "server-device-secret",
            server_urls: ["http://playarr.lan:8484"],
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
          verificationUriComplete:
            "https://playarr.app/link?user_code=ABCD-2345",
          expiresInSeconds: 1,
          intervalSeconds: 2,
          expiresAt: 2_000,
        },
        {
          fetchImpl: fetch as typeof globalThis.fetch,
          now: () => now,
          wait,
        }
      )
    ).resolves.toMatchObject({
      server_device_code: "server-device-secret",
    });

    expect(wait).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledTimes(2);
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

  it("creates and approves the real Playarr Server device code before claiming the hosted code", async () => {
    const fetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify({ linked: true }), { status: 200 })
    );
    vi.stubGlobal("fetch", fetch);
    const requestDeviceCode = vi.fn(async () => ({
      device_code: "server-device-secret",
      user_code: "WXYZ-6789",
      verification_uri: "https://playarr.app/link",
      verification_uri_complete: "https://playarr.app/link?user_code=WXYZ-6789",
      expires_in: 300,
      interval: 5,
    }));
    const authorizeDevice = vi.fn(async () => undefined);
    const client = { requestDeviceCode, authorizeDevice } as unknown as ApiClient;

    await authoriseHostedLink({
      userCode: "ABCD-2345",
      session: { client_platform: "android-tv", expires_at: Date.now() + 60_000, linked: false },
      serverUrl: "http://playarr.lan:8484",
      client,
    });

    expect(requestDeviceCode).toHaveBeenCalledWith({ client_platform: "android-tv" });
    expect(authorizeDevice).toHaveBeenCalledWith({ user_code: "WXYZ-6789" });
    const requestInit = fetch.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(JSON.parse(String(requestInit?.body))).toEqual({
      user_code: "ABCD-2345",
      server_url: "http://playarr.lan:8484",
      server_device_code: "server-device-secret",
      server_urls: ["http://playarr.lan:8484"],
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
        expires_in: 300,
        interval: 5,
      })),
      authorizeDevice: vi.fn(async () => undefined),
    } as unknown as ApiClient;

    await expect(
      authoriseHostedLink({
        userCode: "ABCD-2345",
        session: { client_platform: "tv-tizen", expires_at: Date.now() + 60_000, linked: false },
        serverUrl: "http://playarr.lan:8484",
        client,
      })
    ).rejects.toThrow("That Playarr link code has expired. Generate a new code on the TV.");
  });
});
