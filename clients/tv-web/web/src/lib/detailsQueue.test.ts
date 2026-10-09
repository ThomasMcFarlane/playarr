import { describe, expect, it } from "vitest";
import { DetailsScheduler, isAbortError } from "./detailsQueue";

interface Gate {
  key: string;
  signal: AbortSignal;
  resolve: (value: string) => void;
}

/** A runner whose requests stay open until the test settles them, and that records what is in flight. */
function harness() {
  const gates: Gate[] = [];
  const inflight = new Set<string>();
  let peak = 0;
  const run = (key: string) => (signal: AbortSignal) =>
    new Promise<string>((resolve, reject) => {
      inflight.add(key);
      peak = Math.max(peak, inflight.size);
      const finish = () => inflight.delete(key);
      signal.addEventListener("abort", () => {
        finish();
        reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
      });
      gates.push({
        key,
        signal,
        resolve: (value) => {
          finish();
          resolve(value);
        },
      });
    });
  return { gates, inflight, run, peak: () => peak };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("DetailsScheduler current lane", () => {
  it("starts the current job at once and aborts the previous one when focus moves", async () => {
    const h = harness();
    const s = new DetailsScheduler();
    const a = s.current("a", h.run("a"));
    const aSettled = a.catch((error) => error);
    s.current("b", h.run("b")).catch(() => undefined);
    expect(isAbortError(await aSettled)).toBe(true);
    expect(h.gates[0]!.signal.aborted).toBe(true);
    expect(h.inflight).toEqual(new Set(["b"]));
  });

  it("holding a key never leaves more than one current request in flight", async () => {
    const h = harness();
    const s = new DetailsScheduler();
    for (let i = 0; i < 40; i += 1) s.current(`w${i}`, h.run(`w${i}`)).catch(() => undefined);
    await tick();
    expect(h.peak()).toBe(1);
    expect(h.inflight.size).toBe(1);
    expect(s.stats().current).toBe(1);
  });

  it("joins a repeat request for the key that is already current", () => {
    const h = harness();
    const s = new DetailsScheduler();
    const first = s.current("a", h.run("a"));
    expect(s.current("a", h.run("a"))).toBe(first);
    expect(h.gates).toHaveLength(1);
  });

  it("frees the lane when the current job settles", async () => {
    const h = harness();
    const s = new DetailsScheduler();
    const done = s.current("a", h.run("a"));
    h.gates[0]!.resolve("detail");
    expect(await done).toBe("detail");
    expect(s.stats().current).toBe(0);
  });
});

describe("DetailsScheduler background lane", () => {
  it("runs at most two background jobs, nearest rank first", async () => {
    const h = harness();
    const s = new DetailsScheduler();
    s.setPaused(true);
    for (const [key, rank] of [["far", 5], ["near", 1], ["mid", 3], ["next", 2]] as const) {
      s.background(key, h.run(key), rank).catch(() => undefined);
    }
    s.setPaused(false);
    expect([...h.inflight]).toEqual(["near", "next"]);
    expect(s.stats()).toMatchObject({ running: 2, queued: 2 });
    h.gates.find((gate) => gate.key === "near")!.resolve("x");
    await tick();
    expect([...h.inflight].sort()).toEqual(["mid", "next"]);
  });

  it("keeps one current plus two background jobs in flight at most", () => {
    const h = harness();
    const s = new DetailsScheduler();
    for (let i = 0; i < 10; i += 1) s.background(`n${i}`, h.run(`n${i}`), i).catch(() => undefined);
    for (let i = 0; i < 10; i += 1) s.current(`c${i}`, h.run(`c${i}`)).catch(() => undefined);
    expect(h.peak()).toBeLessThanOrEqual(3);
    expect(h.inflight.size).toBe(3);
  });

  it("does not duplicate a key that is queued, running or current", () => {
    const h = harness();
    const s = new DetailsScheduler();
    const first = s.background("a", h.run("a"), 1);
    expect(s.background("a", h.run("a"), 1)).toBe(first);
    s.current("c", h.run("c")).catch(() => undefined);
    expect(s.background("c", h.run("c"))).toBe(s.current("c", h.run("c")));
    expect(h.gates.map((gate) => gate.key)).toEqual(["a", "c"]);
  });

  it("promotes a running background job to current without restarting it", async () => {
    const h = harness();
    const s = new DetailsScheduler();
    s.background("a", h.run("a"), 1).catch(() => undefined);
    const promoted = s.current("a", h.run("a"));
    expect(h.gates).toHaveLength(1);
    expect(s.stats()).toMatchObject({ current: 1, running: 0 });
    h.gates[0]!.resolve("detail");
    expect(await promoted).toBe("detail");
  });

  it("pulls a queued job forward when it becomes the current one", () => {
    const h = harness();
    const s = new DetailsScheduler({ backgroundConcurrency: 1 });
    s.background("a", h.run("a"), 1).catch(() => undefined);
    s.background("b", h.run("b"), 2).catch(() => undefined);
    s.current("b", h.run("b")).catch(() => undefined);
    expect(h.inflight).toEqual(new Set(["a", "b"]));
    expect(s.stats().queued).toBe(0);
  });

  it("drops queued jobs and aborts running ones that the new focus no longer wants", async () => {
    const h = harness();
    const s = new DetailsScheduler();
    const settled: Record<string, unknown> = {};
    for (const [key, rank] of [["a", 1], ["b", 2], ["c", 3], ["d", 4]] as const) {
      s.background(key, h.run(key), rank).then(() => undefined, (error) => (settled[key] = error));
    }
    s.retainBackground(new Set(["b", "d"]));
    await tick();
    expect(h.gates.find((gate) => gate.key === "a")!.signal.aborted).toBe(true);
    expect(isAbortError(settled.a)).toBe(true);
    expect(isAbortError(settled.c)).toBe(true);
    // "b" kept running; the freed slot goes to the next wanted job.
    expect([...h.inflight].sort()).toEqual(["b", "d"]);
    s.retainBackground();
    await tick();
    expect(h.inflight.size).toBe(0);
    expect(s.stats()).toMatchObject({ running: 0, queued: 0 });
  });

  it("starts nothing new while paused and resumes in rank order", () => {
    const h = harness();
    const s = new DetailsScheduler();
    s.setPaused(true);
    s.background("b", h.run("b"), 2).catch(() => undefined);
    s.background("a", h.run("a"), 1).catch(() => undefined);
    expect(h.inflight.size).toBe(0);
    s.setPaused(false);
    expect([...h.inflight]).toEqual(["a", "b"]);
  });

  it("lets the current job run while the background lane is paused", () => {
    const h = harness();
    const s = new DetailsScheduler();
    s.setPaused(true);
    s.current("a", h.run("a")).catch(() => undefined);
    expect(h.inflight).toEqual(new Set(["a"]));
  });
});
