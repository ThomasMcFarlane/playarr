import { describe, expect, it, vi } from "vitest";
import { ApiClient, QueryCache, tagsForMutation } from "./index";

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
};

describe("QueryCache scoping (never share data between accounts or profiles)", () => {
  it("is off until a scope is named and never stores for an unknown account", async () => {
    const cache = new QueryCache();
    const loader = vi.fn(async () => "a");
    await cache.fetch("k", loader);
    await cache.fetch("k", loader);
    expect(loader).toHaveBeenCalledTimes(2);
    expect(cache.peek("k")).toBeUndefined();
    expect(cache.size).toBe(0);
  });

  it("drops everything when the scope changes, and on sign-out", async () => {
    const cache = new QueryCache();
    cache.setScope("profile-a");
    await cache.fetch("work:1", async () => "A's copy");
    expect(cache.peek("work:1")?.data).toBe("A's copy");
    cache.setScope("profile-b");
    expect(cache.peek("work:1")).toBeUndefined();
    await cache.fetch("work:1", async () => "B's copy");
    cache.setScope("profile-a");
    expect(cache.peek("work:1")).toBeUndefined();
    cache.setScope(undefined);
    expect(cache.peek("work:1")).toBeUndefined();
    expect(cache.enabled).toBe(false);
  });

  it("does not store a result that finished after the scope changed", async () => {
    const cache = new QueryCache();
    cache.setScope("profile-a");
    const slow = deferred<string>();
    const pending = cache.fetch("work:1", () => slow.promise);
    cache.setScope("profile-b");
    slow.resolve("A's copy");
    await pending;
    expect(cache.peek("work:1")).toBeUndefined();
  });
});

describe("QueryCache reads", () => {
  it("shares one in-flight request per key", async () => {
    const cache = new QueryCache();
    cache.setScope("s");
    const gate = deferred<number>();
    const loader = vi.fn(() => gate.promise);
    const a = cache.fetch("k", loader);
    const b = cache.fetch("k", loader);
    gate.resolve(7);
    expect(await Promise.all([a, b])).toEqual([7, 7]);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("serves a value younger than ttlMs without a request and refetches when older", async () => {
    let now = 1_000;
    const cache = new QueryCache({ now: () => now });
    cache.setScope("s");
    const loader = vi.fn(async () => now);
    await cache.fetch("k", loader, { ttlMs: 5_000 });
    now += 4_000;
    await cache.fetch("k", loader, { ttlMs: 5_000 });
    expect(loader).toHaveBeenCalledTimes(1);
    now += 2_000;
    await cache.fetch("k", loader, { ttlMs: 5_000 });
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it("does not cache failures", async () => {
    const cache = new QueryCache();
    cache.setScope("s");
    await expect(cache.fetch("k", async () => Promise.reject(new Error("x")))).rejects.toThrow("x");
    expect(cache.peek("k")).toBeUndefined();
    await expect(cache.fetch("k", async () => "ok")).resolves.toBe("ok");
  });

  it("keeps only the most recently used entries", async () => {
    const cache = new QueryCache({ maxEntries: 2 });
    cache.setScope("s");
    cache.set("a", 1);
    cache.set("b", 2);
    cache.peek("a");
    cache.set("c", 3);
    expect(cache.peek("a")).toBeDefined();
    expect(cache.peek("b")).toBeUndefined();
    expect(cache.peek("c")).toBeDefined();
  });
});

describe("QueryCache invalidation", () => {
  it("drops only the tagged entries, or everything without tags", () => {
    const cache = new QueryCache();
    cache.setScope("s");
    cache.set("home", 1, ["progress", "catalog"]);
    cache.set("lists", 2, ["playlists"]);
    cache.invalidate(["progress"]);
    expect(cache.peek("home")).toBeUndefined();
    expect(cache.peek("lists")).toBeDefined();
    cache.invalidate();
    expect(cache.peek("lists")).toBeUndefined();
  });

  it("does not store a result that was invalidated while it loaded", async () => {
    const cache = new QueryCache();
    cache.setScope("s");
    const gate = deferred<string>();
    const pending = cache.fetch("home", () => gate.promise, { tags: ["progress"] });
    cache.invalidate(["progress"]);
    gate.resolve("old");
    await pending;
    expect(cache.peek("home")).toBeUndefined();
  });

  it("maps writes to what they make stale", () => {
    expect(tagsForMutation("/api/v1/playback/sessions/x/events")).toEqual(["progress"]);
    expect(tagsForMutation("/api/v1/watchlist/abc")).toContain("watchlist");
    expect(tagsForMutation("/api/v1/playlists")).toContain("playlists");
    expect(tagsForMutation("/api/v1/admin/sources")).toBeUndefined();
    // Sign-in and token refresh touch no stored data, so they must not empty the cache.
    expect(tagsForMutation("/api/v1/auth/login")).toEqual([]);
    expect(tagsForMutation("/api/v1/auth/refresh")).toEqual([]);
    expect(tagsForMutation("/api/v1/discover/resolve")).toEqual([]);
    expect(tagsForMutation("/api/v1/home/rails/x")).toContain("progress");
  });
});

describe("ApiClient and the query cache", () => {
  const json = (body: unknown) =>
    new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

  it("shares the household status request, and a write makes it stale at once", async () => {
    const seen: string[] = [];
    const client = new ApiClient({
      baseUrl: "http://localhost:8484",
      getAccessToken: () => "t",
      fetchImpl: async (request) => {
        seen.push(`${request.method} ${new URL(request.url).pathname}`);
        return request.method === "GET" ? json({ mode: "off" }) : json({});
      },
    });
    client.queries.setScope("profile-a");
    await Promise.all([client.getHouseholdStatus(), client.getHouseholdStatus()]);
    await client.getHouseholdStatus();
    expect(seen.filter((s) => s === "GET /api/v1/household/status")).toHaveLength(1);
    await client.raw.POST("/api/v1/household/approvals", { body: {} as never });
    await client.getHouseholdStatus();
    expect(seen.filter((s) => s === "GET /api/v1/household/status")).toHaveLength(2);
  });

  it("sends artwork size and version as query parameters", async () => {
    let url = "";
    const client = new ApiClient({
      baseUrl: "http://localhost:8484",
      getAccessToken: () => "t",
      fetchImpl: async (request) => {
        url = request.url;
        return new Response(new Blob(["x"]), { status: 200, headers: { "content-type": "image/jpeg" } });
      },
    });
    await client.getWorkArtwork("w1", "poster", { width: 360, version: "abc123" });
    expect(new URL(url).searchParams.get("w")).toBe("360");
    expect(new URL(url).searchParams.get("v")).toBe("abc123");
    await client.getWorkArtwork("w1", "poster");
    expect(new URL(url).searchParams.has("w")).toBe(false);
  });
});

describe("QueryCache abortable reads", () => {
  const open = () => {
    const cache = new QueryCache();
    cache.setScope("profile-a");
    return cache;
  };

  it("aborts the request when its only caller walks away, and stores nothing", async () => {
    const cache = open();
    let seen: AbortSignal | undefined;
    const gate = new Promise<string>(() => undefined);
    const controller = new AbortController();
    const pending = cache.fetch("work:1", (signal) => ((seen = signal), gate), { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(seen?.aborted).toBe(true);
    expect(cache.peek("work:1")).toBeUndefined();
  });

  it("keeps a shared request alive for a caller without a signal", async () => {
    const cache = open();
    const slow = deferred<string>();
    let seen: AbortSignal | undefined;
    const background = new AbortController();
    const prefetch = cache.fetch("work:1", (signal) => ((seen = signal), slow.promise), { signal: background.signal });
    const screen = cache.fetch("work:1", () => Promise.resolve("never called"));
    background.abort();
    await expect(prefetch).rejects.toMatchObject({ name: "AbortError" });
    expect(seen?.aborted).toBe(false);
    slow.resolve("detail");
    expect(await screen).toBe("detail");
    expect(cache.peek("work:1")?.data).toBe("detail");
  });

  it("aborts a shared request only when every abortable caller has left", async () => {
    const cache = open();
    let seen: AbortSignal | undefined;
    const a = new AbortController();
    const b = new AbortController();
    const first = cache.fetch("k", (signal) => ((seen = signal), new Promise<string>(() => undefined)), { signal: a.signal });
    const second = cache.fetch("k", () => Promise.resolve("x"), { signal: b.signal });
    a.abort();
    await expect(first).rejects.toMatchObject({ name: "AbortError" });
    expect(seen?.aborted).toBe(false);
    b.abort();
    await expect(second).rejects.toMatchObject({ name: "AbortError" });
    expect(seen?.aborted).toBe(true);
  });

  it("starts a fresh request for a caller that arrives after the last abortable caller left", async () => {
    const cache = open();
    const first = new AbortController();
    const abandoned = cache.fetch("k", () => new Promise<string>(() => undefined), { signal: first.signal });
    first.abort();
    await expect(abandoned).rejects.toMatchObject({ name: "AbortError" });
    const loader = vi.fn(async () => "fresh");
    expect(await cache.fetch("k", loader)).toBe("fresh");
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("rejects at once for a signal that is already aborted", async () => {
    const cache = open();
    const loader = vi.fn(async () => "a");
    await expect(cache.fetch("k", loader, { signal: AbortSignal.abort() })).rejects.toMatchObject({ name: "AbortError" });
    expect(loader).not.toHaveBeenCalled();
  });

  it("tells listeners what was dropped, and when the scope changed", () => {
    const cache = open();
    const seen: Array<{ tags: readonly string[] | undefined; scopeChange: boolean }> = [];
    cache.onInvalidate((event) => seen.push(event));
    cache.invalidate(["progress"]);
    cache.invalidate();
    cache.setScope("profile-b");
    expect(seen).toEqual([
      { tags: ["progress"], scopeChange: false },
      { tags: undefined, scopeChange: false },
      { tags: undefined, scopeChange: true },
    ]);
    expect(cache.currentScope).toBe("profile-b");
  });
});
