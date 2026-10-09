import { describe, expect, it, vi } from "vitest";
import { ApiError } from "@playarr-tv/api-client";
import { isTransientFailure, retryTransient } from "./retryTransient";

const noWait = () => Promise.resolve();

describe("retryTransient", () => {
  it("returns the first answer without waiting", async () => {
    const wait = vi.fn(noWait);
    await expect(retryTransient(async () => 7, [1, 2], wait)).resolves.toBe(7);
    expect(wait).not.toHaveBeenCalled();
  });

  it("retries a dropped connection and a busy server, then succeeds", async () => {
    const load = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockRejectedValueOnce(new ApiError(504, "Gateway Timeout", undefined))
      .mockResolvedValue("ok");
    const wait = vi.fn(noWait);
    await expect(retryTransient(load, [10, 20], wait)).resolves.toBe("ok");
    expect(wait.mock.calls).toEqual([[10], [20]]);
  });

  it("gives up with the last error once the waits run out", async () => {
    const load = vi.fn(async () => {
      throw new ApiError(503, "Unavailable", undefined);
    });
    await expect(retryTransient(load, [1, 1], noWait)).rejects.toMatchObject({ status: 503 });
    expect(load).toHaveBeenCalledTimes(3);
  });

  it("does not retry a final answer", async () => {
    const load = vi.fn(async () => {
      throw new ApiError(403, "Forbidden", undefined);
    });
    await expect(retryTransient(load, [1, 1], noWait)).rejects.toMatchObject({ status: 403 });
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("treats a cancelled request as transient", () => {
    expect(isTransientFailure(new DOMException("aborted", "AbortError"))).toBe(true);
    expect(isTransientFailure(new ApiError(404, "Not Found", undefined))).toBe(false);
  });
});
