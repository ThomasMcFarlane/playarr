import { describe, expect, it } from "vitest";
import { ApiError } from "@playarr-tv/api-client";
import {
  classifyPairingFailure,
  pairingRetryDelayMs,
  retryTransientPairing,
} from "./pairingRetry";

describe("pairingRetryDelayMs", () => {
  it("starts at two seconds, doubles and caps at thirty", () => {
    expect([0, 1, 2, 3, 4, 5, 9].map(pairingRetryDelayMs)).toEqual([
      2000, 4000, 8000, 16000, 30000, 30000, 30000,
    ]);
  });
});

describe("classifyPairingFailure", () => {
  it("treats expiry in any wording as expired", () => {
    expect(classifyPairingFailure(new Error("That Playarr link code expired. Try again."))).toBe("expired");
    expect(classifyPairingFailure(new Error("Device code expired before the user approved the request."))).toBe("expired");
  });

  it("treats network failures and server errors as transient", () => {
    expect(classifyPairingFailure(new TypeError("Failed to fetch"))).toBe("transient");
    expect(classifyPairingFailure(new ApiError(503, "Service Unavailable", null))).toBe("transient");
    expect(classifyPairingFailure(new ApiError(429, "Too Many Requests", null))).toBe("transient");
    expect(classifyPairingFailure(new Error("Playarr linking is unavailable (HTTP 502)."))).toBe("transient");
  });

  it("keeps denial and unexpected failures fatal", () => {
    expect(classifyPairingFailure(new Error("The user denied the device authorization request."))).toBe("fatal");
    expect(classifyPairingFailure(new Error("Device token request failed: unsupported_grant_type"))).toBe("fatal");
    expect(classifyPairingFailure(new ApiError(400, "Bad Request", null))).toBe("fatal");
    expect(classifyPairingFailure(new DOMException("aborted", "AbortError"))).toBe("fatal");
  });
});

describe("retryTransientPairing", () => {
  it("retries transient failures with growing waits and returns the result", async () => {
    const waits: number[] = [];
    let calls = 0;
    const result = await retryTransientPairing(
      async () => {
        calls += 1;
        if (calls < 4) throw new TypeError("Failed to fetch");
        return "ok";
      },
      { wait: async (ms) => void waits.push(ms) }
    );
    expect(result).toBe("ok");
    expect(waits).toEqual([2000, 4000, 8000]);
  });

  it("rethrows expiry and denial without waiting", async () => {
    const waits: number[] = [];
    await expect(
      retryTransientPairing(async () => Promise.reject(new Error("code expired")), {
        wait: async (ms) => void waits.push(ms),
      })
    ).rejects.toThrow(/expired/);
    await expect(
      retryTransientPairing(async () => Promise.reject(new Error("The user denied the device authorization request.")), {
        wait: async (ms) => void waits.push(ms),
      })
    ).rejects.toThrow(/denied/);
    expect(waits).toEqual([]);
  });

  it("stops retrying once aborted", async () => {
    const controller = new AbortController();
    let calls = 0;
    await expect(
      retryTransientPairing(
        async () => {
          calls += 1;
          controller.abort();
          throw new TypeError("Failed to fetch");
        },
        { signal: controller.signal, wait: async () => undefined }
      )
    ).rejects.toThrow();
    expect(calls).toBe(1);
  });
});
