import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { backoffDelayMs, createLiveCoordinator, isEventStreamResponse } from "./coordinator";
import { createLiveRegistry, type LiveRegistry } from "./registry";

const encoder = new TextEncoder();

interface MockStream {
  response: Response;
  push: (text: string) => Promise<void>;
  close: () => Promise<void>;
  signal: AbortSignal;
  lastEventId: string | undefined;
}

function sse(status = 200, contentType = "text/event-stream") {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
  });
  const mock = {
    response: new Response(body, { status, headers: { "content-type": contentType } }),
    push: async (text: string) => {
      controller.enqueue(encoder.encode(text));
      await vi.advanceTimersByTimeAsync(0);
    },
    close: async () => {
      controller.close();
      await vi.advanceTimersByTimeAsync(0);
    },
  } as MockStream;
  return mock;
}

const ready = (id: number, extra: Record<string, unknown> = {}) =>
  `id: ${id}\nevent: ready\ndata: ${JSON.stringify({
    seq: id,
    retention_ms: 600_000,
    heartbeat_ms: 15_000,
    max_age_ms: 300_000,
    server_time_ms: Date.now(),
    ...extra,
  })}\n\n`;

const change = (id: number, type: string, entity: string, key: string | undefined, changed: string[], at = Date.now() + 5) =>
  `id: ${id}\nevent: change\ndata: ${JSON.stringify({ seq: id, type, entity, id: key, changed, at })}\n\n`;

let registry: LiveRegistry;
let opens: Array<{ lastEventId?: string; signal: AbortSignal }>;
let queue: Array<() => Promise<Response>>;

function setup(pollIntervalMs = 30_000) {
  opens = [];
  queue = [];
  registry = createLiveRegistry({ debounceMs: 200 });
  return createLiveCoordinator({
    registry,
    pollIntervalMs,
    random: () => 0,
    open: (options) => {
      opens.push(options);
      const next = queue.shift();
      if (!next) return new Promise<Response>(() => undefined); // hang until aborted
      return next();
    },
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(10_000_000);
});
afterEach(() => vi.useRealTimers());

describe("pure helpers", () => {
  it("backs off 1 s, 2 s, 4 s ... capped at 30 s with bounded jitter", () => {
    expect([0, 1, 2, 3, 4, 5, 6, 10].map((n) => backoffDelayMs(n, 0))).toEqual([
      1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000,
    ]);
    expect(backoffDelayMs(0, 1)).toBe(1250);
    expect(backoffDelayMs(8, 1)).toBe(30000);
  });

  it("detects unsupported responses by status and content type", () => {
    const html = new Response("<html>", { status: 200, headers: { "content-type": "text/html" } });
    const missing = new Response("nope", { status: 404, headers: { "content-type": "text/event-stream" } });
    const good = new Response("", { status: 200, headers: { "content-type": "text/event-stream; charset=utf-8" } });
    expect(isEventStreamResponse(html)).toBe(false);
    expect(isEventStreamResponse(missing)).toBe(false);
    expect(isEventStreamResponse(good)).toBe(true);
  });
});

describe("live coordinator", () => {
  it("goes live on ready and invalidates precisely from change frames", async () => {
    const coordinator = setup();
    const a = vi.fn();
    const b = vi.fn();
    registry.register({ areas: ["progress"], keys: ["A"] }, a);
    registry.register({ areas: ["progress"], keys: ["B"] }, b);
    const stream = sse();
    queue.push(async () => stream.response);
    coordinator.setActive(true);
    await vi.advanceTimersByTimeAsync(0);
    await stream.push(ready(5));
    expect(coordinator.status()).toBe("live");
    await stream.push(change(6, "watch", "work", "A", ["progress"]));
    await vi.advanceTimersByTimeAsync(300);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).not.toHaveBeenCalled();
    coordinator.dispose();
  });

  it("an import frame pair refetches the open work page, library and calendar in place", async () => {
    const coordinator = setup();
    const workPage = vi.fn();
    const otherWorkPage = vi.fn();
    const library = vi.fn();
    const calendar = vi.fn();
    registry.register({ areas: ["catalog", "progress"], keys: ["series-1", "ep-1"] }, workPage);
    registry.register({ areas: ["catalog", "progress"], keys: ["other"] }, otherWorkPage);
    registry.register({ areas: ["catalog"] }, library);
    registry.register({ areas: ["calendar"] }, calendar);
    const stream = sse();
    queue.push(async () => stream.response);
    coordinator.setActive(true);
    await vi.advanceTimersByTimeAsync(0);
    await stream.push(ready(20));
    // The two frames the server publishes for one new media_files row
    // (EventingMediaFileRepo): library/files and calendar/imported.
    await stream.push(change(21, "library", "work", "series-1", ["files"]));
    await stream.push(change(22, "calendar", "work", "series-1", ["imported"]));
    await vi.advanceTimersByTimeAsync(300);
    expect(workPage).toHaveBeenCalledTimes(1);
    expect(library).toHaveBeenCalledTimes(1);
    expect(calendar).toHaveBeenCalledTimes(1);
    expect(otherWorkPage).not.toHaveBeenCalled();
    expect(opens).toHaveLength(1); // no reconnect or reload involved
    coordinator.dispose();
  });

  it("treats a non-SSE response as unsupported: polls, never retries until foreground", async () => {
    const coordinator = setup(30_000);
    const consumer = vi.fn();
    registry.register({ areas: ["catalog"] }, consumer);
    queue.push(async () => new Response("<html></html>", { status: 200, headers: { "content-type": "text/html" } }));
    coordinator.setActive(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(coordinator.status()).toBe("unsupported");
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(opens).toHaveLength(1);
    expect(consumer).toHaveBeenCalledTimes(10); // every 30 s
    // Next foreground retries once.
    coordinator.setActive(false);
    coordinator.setActive(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(opens).toHaveLength(2);
    coordinator.dispose();
  });

  it("treats a 404 as unsupported but a 503 as a transient retry", async () => {
    const coordinator = setup();
    queue.push(async () => new Response("no", { status: 404 }));
    coordinator.setActive(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(coordinator.status()).toBe("unsupported");
    coordinator.dispose();

    const other = setup();
    queue.push(async () => new Response("busy", { status: 503 }));
    other.setActive(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(other.status()).toBe("down");
    await vi.advanceTimersByTimeAsync(1000);
    expect(opens).toHaveLength(2);
    other.dispose();
  });

  it("reconnects with growing backoff after failures, and resets after a stable minute", async () => {
    const coordinator = setup();
    for (let i = 0; i < 4; i += 1) queue.push(async () => Promise.reject(new Error("offline")));
    coordinator.setActive(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(opens).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(999);
    expect(opens).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(opens).toHaveLength(2); // after 1 s
    await vi.advanceTimersByTimeAsync(1999);
    expect(opens).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(opens).toHaveLength(3); // after 2 s more
    await vi.advanceTimersByTimeAsync(4000);
    expect(opens).toHaveLength(4); // after 4 s more

    // A stream that stays up for a minute resets the backoff and reconnects at once on close.
    const stream = sse();
    queue.push(async () => stream.response);
    await vi.advanceTimersByTimeAsync(8000); // next attempt (8 s) gets the stream
    await stream.push(ready(1));
    expect(coordinator.status()).toBe("live");
    await vi.advanceTimersByTimeAsync(61_000);
    await stream.close();
    await vi.advanceTimersByTimeAsync(0);
    expect(opens.length).toBe(6); // immediate reconnect, no backoff
    coordinator.dispose();
  });

  it("sends Last-Event-ID on reconnect", async () => {
    const coordinator = setup();
    const first = sse();
    queue.push(async () => first.response);
    coordinator.setActive(true);
    await vi.advanceTimersByTimeAsync(0);
    await first.push(ready(10));
    await first.push(change(11, "library", "work", "w", ["files"]));
    await vi.advanceTimersByTimeAsync(61_000);
    await first.close();
    await vi.advanceTimersByTimeAsync(0);
    expect(opens[0]?.lastEventId).toBeUndefined();
    expect(opens[1]?.lastEventId).toBe("11");
    coordinator.dispose();
  });

  it("pauses when hidden and resumes with Last-Event-ID without a refetch inside retention", async () => {
    const coordinator = setup();
    const consumer = vi.fn();
    registry.register({ areas: ["progress"] }, consumer);
    const first = sse();
    queue.push(async () => first.response);
    coordinator.setActive(true);
    await vi.advanceTimersByTimeAsync(0);
    await first.push(ready(3));
    coordinator.setActive(false);
    expect(coordinator.status()).toBe("paused");
    expect(opens[0]?.signal.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(opens).toHaveLength(1); // nothing while hidden, no polling either
    expect(consumer).not.toHaveBeenCalled();
    coordinator.setActive(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(opens[1]?.lastEventId).toBe("3");
    expect(consumer).not.toHaveBeenCalled();
    coordinator.dispose();
  });

  it("invalidates everything when hidden for longer than retention_ms", async () => {
    const coordinator = setup();
    const consumer = vi.fn();
    registry.register({ areas: ["catalog"], keys: ["x"] }, consumer);
    const first = sse();
    queue.push(async () => first.response);
    coordinator.setActive(true);
    await vi.advanceTimersByTimeAsync(0);
    await first.push(ready(3, { retention_ms: 60_000 }));
    coordinator.setActive(false);
    await vi.advanceTimersByTimeAsync(61_000);
    coordinator.setActive(true);
    expect(consumer).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(0);
    expect(opens[1]?.lastEventId).toBeUndefined();
    coordinator.dispose();
  });

  it("refetches everything on a resync frame", async () => {
    const coordinator = setup();
    const consumer = vi.fn();
    registry.register({ areas: ["calendar"], keys: ["only"] }, consumer);
    const stream = sse();
    queue.push(async () => stream.response);
    coordinator.setActive(true);
    await vi.advanceTimersByTimeAsync(0);
    await stream.push(ready(2));
    await stream.push('id: 40\nevent: resync\ndata: {"reason":"cursor_too_old","seq":40}\n\n');
    expect(consumer).toHaveBeenCalledTimes(1);
    coordinator.dispose();
  });

  it("refetches once after reconnecting following a gap", async () => {
    const coordinator = setup();
    const consumer = vi.fn();
    registry.register({ areas: ["watchlist"] }, consumer);
    queue.push(async () => Promise.reject(new Error("down")));
    const stream = sse();
    queue.push(async () => stream.response);
    coordinator.setActive(true);
    await vi.advanceTimersByTimeAsync(1000);
    await stream.push(ready(9));
    expect(consumer).toHaveBeenCalledTimes(1);
    coordinator.dispose();
  });

  it("polls only while the stream is not healthy (30 s foreground, configurable for TV)", async () => {
    const coordinator = setup(60_000);
    const consumer = vi.fn();
    registry.register({ areas: ["household"] }, consumer);
    const stream = sse();
    let release!: (response: Response) => void;
    queue.push(async () => Promise.reject(new Error("down")));
    queue.push(async () => Promise.reject(new Error("down")));
    queue.push(() => new Promise<Response>((resolve) => (release = resolve)));
    coordinator.setActive(true);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(consumer).toHaveBeenCalledTimes(1);
    release(stream.response);
    await vi.advanceTimersByTimeAsync(0);
    await stream.push(ready(1));
    expect(coordinator.status()).toBe("live");
    const callsWhenLive = consumer.mock.calls.length;
    for (let i = 0; i < 11; i += 1) {
      await vi.advanceTimersByTimeAsync(15_000);
      await stream.push(": hb\n\n");
    }
    expect(consumer).toHaveBeenCalledTimes(callsWhenLive); // healthy: no polling
    coordinator.dispose();
  });

  it("drops a silent stream through the watchdog and reconnects", async () => {
    const coordinator = setup();
    const stream = sse();
    queue.push(async () => stream.response);
    coordinator.setActive(true);
    await vi.advanceTimersByTimeAsync(0);
    await stream.push(ready(1, { heartbeat_ms: 10_000 }));
    await vi.advanceTimersByTimeAsync(31_000);
    expect(opens[0]?.signal.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(2000);
    expect(opens.length).toBeGreaterThanOrEqual(2);
    coordinator.dispose();
  });

  it("reset forgets the cursor for a new account or server", async () => {
    const coordinator = setup();
    const stream = sse();
    queue.push(async () => stream.response);
    coordinator.setActive(true);
    await vi.advanceTimersByTimeAsync(0);
    await stream.push(ready(77));
    coordinator.reset();
    await vi.advanceTimersByTimeAsync(0);
    expect(opens[1]?.lastEventId).toBeUndefined();
    coordinator.dispose();
  });
});
