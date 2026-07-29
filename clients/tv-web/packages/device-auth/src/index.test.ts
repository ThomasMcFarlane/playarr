import { describe, expect, it, vi } from "vitest";
import { ApiClient } from "@playarr-tv/api-client";
import { createQrCodeSvg, pollDeviceToken, pollForToken, requestDeviceCode } from "./index";

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

describe("createQrCodeSvg", () => {
  it("renders the complete verification URL locally as an SVG", async () => {
    const svg = await createQrCodeSvg("https://playarr.example/link?user_code=WXYZ-1234", 180);
    expect(svg).toContain("<svg");
    expect(svg).toContain('width="180"');
  });

  it("uses the shared Playarr login/qr module colours", async () => {
    const { PLAYARR_QR_STYLE, createQrCodeSvg: make } = await import("./index");
    expect(PLAYARR_QR_STYLE.tileSize).toBe(240);
    expect(PLAYARR_QR_STYLE.borderPx).toBe(12);
    expect(PLAYARR_QR_STYLE.contentSize).toBe(216);
    expect(PLAYARR_QR_STYLE.radiusPx).toBe(18);
    expect(PLAYARR_QR_STYLE.marginModules).toBe(2);
    expect(PLAYARR_QR_STYLE.errorCorrectionLevel).toBe("M");
    expect(PLAYARR_QR_STYLE.shadow.blur).toBe(72);
    const svg = await make("https://playarr.example/link?user_code=WXYZ-1234");
    // qrcode embeds fill on path/rect; dark modules must be pure black.
    expect(svg).toMatch(/#000000|fill="black"|rgb\(0,\s*0,\s*0\)/i);
  });
});

describe("requestDeviceCode", () => {
  it("posts the real DeviceCodeRequest shape and normalizes the response to camelCase", async () => {
    const client = new ApiClient({
      baseUrl: BASE_URL,
      fetchImpl: mockFetch(async (request) => {
        expect(await request.json()).toEqual({ client_platform: "tv-tizen" });
        return jsonResponse(200, {
          device_code: "dc-1",
          user_code: "WXYZ-1234",
          verification_uri: "https://playarr.example/link",
          verification_uri_complete: "https://playarr.example/link?code=WXYZ-1234",
          expires_in: 900,
          interval: 5,
        });
      }),
    });

    const response = await requestDeviceCode(client, "tv-tizen");
    expect(response).toEqual({
      deviceCode: "dc-1",
      userCode: "WXYZ-1234",
      verificationUri: "https://playarr.example/link",
      verificationUriComplete: "https://playarr.example/link?code=WXYZ-1234",
      expiresInSeconds: 900,
      intervalSeconds: 5,
    });
  });
});

describe("pollDeviceToken", () => {
  const cases: Array<[string, "authorization_pending" | "slow_down" | "expired_token" | "access_denied"]> = [
    ["authorization_pending", "authorization_pending"],
    ["slow_down", "slow_down"],
    ["expired_token", "expired_token"],
    ["access_denied", "access_denied"],
  ];

  it.each(cases)("maps RFC 8628 error code %s to status %s", async (errorCode, expectedStatus) => {
    const client = new ApiClient({
      baseUrl: BASE_URL,
      fetchImpl: mockFetch(() => jsonResponse(400, { error: errorCode })),
    });

    const result = await pollDeviceToken(client, "dc-1");
    expect(result).toEqual({ status: expectedStatus });
  });

  it("maps an unrecognized error (e.g. unsupported_grant_type) to the generic error status", async () => {
    const client = new ApiClient({
      baseUrl: BASE_URL,
      fetchImpl: mockFetch(() => jsonResponse(400, { error: "unsupported_grant_type" })),
    });

    const result = await pollDeviceToken(client, "dc-1");
    expect(result).toEqual({ status: "error", error: "unsupported_grant_type" });
  });

  it("returns a success result with the real TokenResponseSchema fields on 200", async () => {
    const client = new ApiClient({
      baseUrl: BASE_URL,
      fetchImpl: mockFetch(() =>
        jsonResponse(200, {
          access_token: "at-1",
          refresh_token: "rt-1",
          token_type: "Bearer",
          expires_in: 3600,
        })
      ),
    });

    const result = await pollDeviceToken(client, "dc-1");
    expect(result).toEqual({
      status: "success",
      accessToken: "at-1",
      refreshToken: "rt-1",
      tokenType: "Bearer",
      expiresInSeconds: 3600,
    });
  });

  it("rethrows non-OAuth errors (e.g. a 500) instead of swallowing them", async () => {
    const client = new ApiClient({
      baseUrl: BASE_URL,
      fetchImpl: mockFetch(() => new Response(null, { status: 500, statusText: "Internal Server Error" })),
    });

    await expect(pollDeviceToken(client, "dc-1")).rejects.toMatchObject({ status: 500 });
  });

  it("aborts an in-flight token request", async () => {
    let markRequestStarted!: (request: Request) => void;
    const requestStarted = new Promise<Request>((resolve) => {
      markRequestStarted = resolve;
    });
    const client = new ApiClient({
      baseUrl: BASE_URL,
      fetchImpl: vi.fn(
        (request: Request) =>
          new Promise<Response>((_resolve, reject) => {
            markRequestStarted(request);
            request.signal.addEventListener(
              "abort",
              () => reject(request.signal.reason),
              { once: true }
            );
          })
      ),
    });
    const controller = new AbortController();
    const result = pollDeviceToken(client, "dc-1", controller.signal);
    const request = await requestStarted;

    controller.abort();

    expect(request.signal.aborted).toBe(true);
    await expect(result).rejects.toMatchObject({ name: "AbortError" });
  });
});

describe("pollForToken", () => {
  it("keeps polling through authorization_pending and slow_down, then resolves on success", async () => {
    // Note: a real `slow_down` response bumps the interval by 5s per RFC 8628 §3.5,
    // so this test's own polling loop takes a bit over 5s wall-clock -- give it headroom.
    let call = 0;
    const client = new ApiClient({
      baseUrl: BASE_URL,
      fetchImpl: mockFetch(() => {
        call += 1;
        if (call === 1) return jsonResponse(400, { error: "authorization_pending" });
        if (call === 2) return jsonResponse(400, { error: "slow_down" });
        return jsonResponse(200, {
          access_token: "at-final",
          refresh_token: "rt-final",
          token_type: "Bearer",
          expires_in: 3600,
        });
      }),
    });

    const onPending = vi.fn();
    const result = await pollForToken(
      client,
      { deviceCode: "dc-1", userCode: "U", verificationUri: "v", verificationUriComplete: "v", expiresInSeconds: 60, intervalSeconds: 0 },
      { onPending }
    );

    expect(result.accessToken).toBe("at-final");
    expect(call).toBe(3);
    expect(onPending).toHaveBeenCalledTimes(1);
  }, 10_000);

  it("throws once the device code expires", async () => {
    const client = new ApiClient({
      baseUrl: BASE_URL,
      fetchImpl: mockFetch(() => jsonResponse(400, { error: "authorization_pending" })),
    });

    await expect(
      pollForToken(
        client,
        { deviceCode: "dc-1", userCode: "U", verificationUri: "v", verificationUriComplete: "v", expiresInSeconds: 0, intervalSeconds: 0 },
        {}
      )
    ).rejects.toThrow(/expired/i);
  });

  it("does not poll once its wait has crossed the expiry deadline", async () => {
    vi.useFakeTimers();
    try {
      const fetch = mockFetch(() =>
        jsonResponse(400, { error: "authorization_pending" })
      );
      const client = new ApiClient({ baseUrl: BASE_URL, fetchImpl: fetch });
      const result = expect(
        pollForToken(
          client,
          {
            deviceCode: "dc-1",
            userCode: "U",
            verificationUri: "v",
            verificationUriComplete: "v",
            expiresInSeconds: 1,
            intervalSeconds: 5,
          },
          {}
        )
      ).rejects.toThrow(/expired/i);

      await vi.advanceTimersByTimeAsync(5_000);
      await result;
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("throws when the user denies the request", async () => {
    const client = new ApiClient({
      baseUrl: BASE_URL,
      fetchImpl: mockFetch(() => jsonResponse(400, { error: "access_denied" })),
    });

    await expect(
      pollForToken(
        client,
        { deviceCode: "dc-1", userCode: "U", verificationUri: "v", verificationUriComplete: "v", expiresInSeconds: 60, intervalSeconds: 0 },
        {}
      )
    ).rejects.toThrow(/denied/i);
  });
});
