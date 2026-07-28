import { describe, expect, it, vi } from "vitest";
import type { RefreshRequest, RefreshResponse } from "@playarr-tv/api-client";
import type { PlayarrCastCredentials } from "@playarr-tv/cast-protocol";
import { CastCredentialStore, type CastAuthRefreshClient } from "./auth";

function makeCredentials(overrides: Partial<PlayarrCastCredentials> = {}): PlayarrCastCredentials {
  return {
    deviceId: "device-1",
    accessToken: "access-token-1",
    accessTokenExpiresAt: 1_000_000,
    refreshToken: "refresh-token-1",
    ...overrides,
  };
}

/** A hand-rolled fake timer: `setTimeoutFn`/`clearTimeoutFn` just record scheduled callbacks, and the test fires them manually via `fire()` -- no reliance on vitest's global fake timers. */
function makeFakeScheduler() {
  let nextHandle = 1;
  const scheduled = new Map<number, () => void>();
  return {
    setTimeoutFn: vi.fn((handler: () => void) => {
      const handle = nextHandle++;
      scheduled.set(handle, handler);
      return handle as unknown as ReturnType<typeof setTimeout>;
    }),
    clearTimeoutFn: vi.fn((handle: ReturnType<typeof setTimeout>) => {
      scheduled.delete(handle as unknown as number);
    }),
    fireLatest(): void {
      const lastHandle = Math.max(...scheduled.keys());
      scheduled.get(lastHandle)?.();
    },
    pendingCount(): number {
      return scheduled.size;
    },
  };
}

describe("CastCredentialStore", () => {
  it("has no access token until credentials are installed", () => {
    const store = new CastCredentialStore({ refresh: vi.fn() });
    expect(store.currentAccessToken()).toBeUndefined();
    expect(store.hasCredentials).toBe(false);
  });

  it("currentAccessToken() is synchronous and reflects the installed credentials immediately", () => {
    const store = new CastCredentialStore({ refresh: vi.fn() }, { now: () => 0 });
    store.setCredentials(makeCredentials({ accessToken: "abc" }));
    expect(store.currentAccessToken()).toBe("abc");
    expect(store.deviceId).toBe("device-1");
    expect(store.hasCredentials).toBe(true);
  });

  it("schedules the proactive refresh at expiresAt minus the minimum validity window", () => {
    const scheduler = makeFakeScheduler();
    const store = new CastCredentialStore(
      { refresh: vi.fn() },
      { now: () => 0, minimumValidityMs: 120_000, ...scheduler }
    );
    store.setCredentials(makeCredentials({ accessTokenExpiresAt: 900_000 }));
    expect(scheduler.setTimeoutFn).toHaveBeenCalledWith(expect.any(Function), 780_000);
  });

  it("clamps the refresh delay to zero when credentials are already past their renewal window", () => {
    const scheduler = makeFakeScheduler();
    const store = new CastCredentialStore(
      { refresh: vi.fn() },
      { now: () => 1_000_000, minimumValidityMs: 120_000, ...scheduler }
    );
    store.setCredentials(makeCredentials({ accessTokenExpiresAt: 900_000 }));
    expect(scheduler.setTimeoutFn).toHaveBeenCalledWith(expect.any(Function), 0);
  });

  it("re-schedules (and clears the previous timer) when new credentials are installed", () => {
    const scheduler = makeFakeScheduler();
    const store = new CastCredentialStore({ refresh: vi.fn() }, { now: () => 0, ...scheduler });
    store.setCredentials(makeCredentials());
    store.setCredentials(makeCredentials({ accessToken: "second" }));
    expect(scheduler.clearTimeoutFn).toHaveBeenCalledTimes(1);
    expect(scheduler.pendingCount()).toBe(1);
  });

  it("refreshNow() rotates the credentials, reschedules, and calls onRotated", async () => {
    const refresh = vi.fn(async (body: RefreshRequest): Promise<RefreshResponse> => {
      expect(body).toEqual({ device_id: "device-1", refresh_token: "refresh-token-1" });
      return {
        access_token: "access-token-2",
        expires_in: 900,
        refresh_token: "refresh-token-2",
        token_type: "Bearer",
        user_id: "user-1",
      };
    });
    const scheduler = makeFakeScheduler();
    const onRotated = vi.fn();
    const store = new CastCredentialStore(
      { refresh },
      { now: () => 500_000, onRotated, ...scheduler }
    );
    store.setCredentials(makeCredentials());
    scheduler.setTimeoutFn.mockClear();

    await store.refreshNow();

    expect(store.currentAccessToken()).toBe("access-token-2");
    expect(onRotated).toHaveBeenCalledWith({
      deviceId: "device-1",
      accessToken: "access-token-2",
      accessTokenExpiresAt: 500_000 + 900 * 1000,
      refreshToken: "refresh-token-2",
    });
    // Rotating triggers a fresh proactive-refresh schedule off the new expiry.
    expect(scheduler.setTimeoutFn).toHaveBeenCalledTimes(1);
  });

  it("refreshNow() is a no-op before any credentials are installed", async () => {
    const refresh = vi.fn();
    const store = new CastCredentialStore({ refresh });
    await store.refreshNow();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("concurrent refreshNow() calls share a single in-flight refresh", async () => {
    let resolveRefresh: (value: Awaited<ReturnType<CastAuthRefreshClient["refresh"]>>) => void = () => {};
    const refresh = vi.fn(
      () =>
        new Promise<Awaited<ReturnType<CastAuthRefreshClient["refresh"]>>>((resolve) => {
          resolveRefresh = resolve;
        })
    );
    const store = new CastCredentialStore({ refresh }, { now: () => 0 });
    store.setCredentials(makeCredentials());

    const first = store.refreshNow();
    const second = store.refreshNow();
    expect(refresh).toHaveBeenCalledTimes(1);

    resolveRefresh({
      access_token: "a2",
      expires_in: 900,
      refresh_token: "r2",
      token_type: "Bearer",
      user_id: "user-1",
    });
    await Promise.all([first, second]);
    expect(store.currentAccessToken()).toBe("a2");
  });

  it("calls onRefreshFailed (and keeps the previous token) when the refresh request fails", async () => {
    const onRefreshFailed = vi.fn();
    const failure = new Error("refresh token revoked");
    const store = new CastCredentialStore(
      {
        refresh: vi.fn(async () => {
          throw failure;
        }),
      },
      { now: () => 0, onRefreshFailed }
    );
    store.setCredentials(makeCredentials({ accessToken: "still-valid" }));

    await store.refreshNow();

    expect(onRefreshFailed).toHaveBeenCalledWith(failure);
    expect(store.currentAccessToken()).toBe("still-valid");
  });

  it("the scheduled timer firing performs a real refresh", async () => {
    const refresh = vi.fn(async () => ({
      access_token: "a2",
      expires_in: 900,
      refresh_token: "r2",
      token_type: "Bearer",
      user_id: "user-1",
    }));
    const scheduler = makeFakeScheduler();
    const store = new CastCredentialStore({ refresh }, { now: () => 0, ...scheduler });
    store.setCredentials(makeCredentials());

    scheduler.fireLatest();
    // The timer callback fires the refresh but does not await it internally;
    // give the microtask queue a turn.
    await Promise.resolve();
    await Promise.resolve();

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(store.currentAccessToken()).toBe("a2");
  });

  it("dispose() clears any pending refresh timer", () => {
    const scheduler = makeFakeScheduler();
    const store = new CastCredentialStore({ refresh: vi.fn() }, { now: () => 0, ...scheduler });
    store.setCredentials(makeCredentials());
    store.dispose();
    expect(scheduler.clearTimeoutFn).toHaveBeenCalledTimes(1);
    expect(scheduler.pendingCount()).toBe(0);
  });
});
