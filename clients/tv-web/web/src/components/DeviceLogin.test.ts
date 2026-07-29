import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { DeviceCodeResponse } from "@playarr-tv/device-auth";
import {
  deviceCodeExpiresAt,
  deviceCodeSecondsRemaining,
  directDeviceLoginConnection,
  formatDeviceCodeCountdown,
} from "./DeviceLogin";

const code: DeviceCodeResponse = {
  deviceCode: "device-secret",
  userCode: "ABCD-2345",
  verificationUri: "https://playarr.example/link",
  verificationUriComplete:
    "https://playarr.example/link?user_code=ABCD-2345",
  expiresInSeconds: 300,
  intervalSeconds: 5,
};

describe("DeviceLogin countdown", () => {
  it("starts at five minutes and stays aligned to an absolute deadline", () => {
    const expiresAt = deviceCodeExpiresAt(code, 1_000);

    expect(expiresAt).toBe(301_000);
    expect(deviceCodeSecondsRemaining(expiresAt, 1_000)).toBe(300);
    expect(formatDeviceCodeCountdown(300)).toBe("5:00");
    expect(deviceCodeSecondsRemaining(expiresAt, 300_001)).toBe(1);
    expect(formatDeviceCodeCountdown(1)).toBe("0:01");
    expect(deviceCodeSecondsRemaining(expiresAt, 301_001)).toBe(0);
    expect(formatDeviceCodeCountdown(-1)).toBe("0:00");
  });

  it("honours an absolute hosted-broker expiry", () => {
    expect(
      deviceCodeExpiresAt({ ...code, expiresAt: 42_000 } as DeviceCodeResponse, 1_000)
    ).toBe(42_000);
  });

  it("caps server-provided lifetimes at five minutes", () => {
    expect(
      deviceCodeExpiresAt({ ...code, expiresInSeconds: 900 }, 1_000)
    ).toBe(301_000);
    expect(
      deviceCodeExpiresAt(
        { ...code, expiresAt: 901_000 } as DeviceCodeResponse,
        1_000
      )
    ).toBe(301_000);
  });

  it("rejects missing or expired lifetimes instead of refreshing in a loop", () => {
    expect(() =>
      deviceCodeExpiresAt({ ...code, expiresInSeconds: 0 }, 1_000)
    ).toThrow(/invalid device-code expiry/i);
    expect(() =>
      deviceCodeExpiresAt(
        { ...code, expiresAt: 999 } as DeviceCodeResponse,
        1_000
      )
    ).toThrow(/invalid device-code expiry/i);
  });

  it("returns the selected server as the direct-login connection", () => {
    expect(
      directDeviceLoginConnection(
        "https://media.example.test",
        "https://media.example.test/link?user_code=ABCD-2345"
      )
    ).toEqual({
      serverUrl: "https://media.example.test",
      serverUrls: ["https://media.example.test"],
    });
  });

  it("aborts the old polling attempt before requesting a replacement code", () => {
    const source = readFileSync(new URL("./DeviceLogin.tsx", import.meta.url), "utf8");
    const renewStart = source.indexOf("const renewCode");
    const abort = source.indexOf("controller.abort()", renewStart);
    const nextAttempt = source.indexOf("setAttempt((value) => value + 1)", renewStart);

    expect(renewStart).toBeGreaterThan(-1);
    expect(abort).toBeGreaterThan(renewStart);
    expect(nextAttempt).toBeGreaterThan(abort);
    expect(source).toContain("refreshTimeout = window.setTimeout(");
    expect(source).toContain("setDeviceCode(null)");
    expect(source).toContain(
      "setSecondsRemaining(MAX_DEVICE_CODE_LIFETIME_SECONDS)"
    );
    expect(source).toContain("device-login-qr-placeholder");
    expect(source).toContain(
      "secondsRemaining ?? MAX_DEVICE_CODE_LIFETIME_SECONDS"
    );
    expect(source).toContain("const directClient = hostedLink ? null : client");
    expect(source).toContain(
      "[attempt, directClient, directServerUrl, hostedLink]"
    );
    expect(source).toContain('"X-Playarr-Client-Platform"');
    expect(source).toContain('"X-Playarr-Client-Version"');
  });
});
