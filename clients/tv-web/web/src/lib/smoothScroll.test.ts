import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MAX_DURATION_MS,
  MIN_DURATION_MS,
  REPEAT_DURATION_MS,
  RETARGET_DURATION_MS,
  cancelSmoothScroll,
  durationForDistance,
  easeOutCubic,
  holdScroll,
  isSmoothScrolling,
  ownHorizontalScroll,
  retargetDuration,
  revealDelta,
  setScrollInstant,
  settledScrollOffset,
  smoothScrollTo,
} from "./smoothScroll";

interface FakeScroller extends HTMLElement {
  writes: number[];
  behaviourAtWrite: Array<string | undefined>;
}

function fakeScroller(): FakeScroller {
  let top = 0;
  const writes: number[] = [];
  const style = new Map<string, string>();
  return {
    isConnected: true,
    writes,
    behaviourAtWrite: [] as Array<string | undefined>,
    get scrollTop() {
      return top;
    },
    set scrollTop(value: number) {
      top = value;
      writes.push(value);
      (this as unknown as { behaviourAtWrite: Array<string | undefined> }).behaviourAtWrite.push(style.get("scroll-behavior"));
    },
    scrollLeft: 0,
    style: {
      setProperty: (k: string, v: string) => style.set(k, v),
      removeProperty: (k: string) => style.delete(k),
    },
  } as unknown as FakeScroller;
}

let now = 0;
let frames: Array<(t: number) => void> = [];

function advance(ms: number) {
  now += ms;
  const queued = frames;
  frames = [];
  queued.forEach((cb) => cb(now));
}

beforeEach(() => {
  now = 1000;
  frames = [];
  vi.stubGlobal("performance", { now: () => now });
  vi.stubGlobal("window", {
    matchMedia: () => ({ matches: false }),
    requestAnimationFrame: (cb: (t: number) => void) => frames.push(cb),
    cancelAnimationFrame: (id: number) => {
      frames[id - 1] = () => undefined;
    },
    getComputedStyle: () => ({}),
  });
});

afterEach(() => vi.unstubAllGlobals());

describe("easeOutCubic", () => {
  it("is anchored and monotonic", () => {
    expect(easeOutCubic(0)).toBe(0);
    expect(easeOutCubic(1)).toBe(1);
    expect(easeOutCubic(0.5)).toBeGreaterThan(0.5);
    expect(easeOutCubic(2)).toBe(1);
    let last = 0;
    for (let t = 0; t <= 1; t += 0.05) {
      expect(easeOutCubic(t)).toBeGreaterThanOrEqual(last);
      last = easeOutCubic(t);
    }
  });
});

describe("durations", () => {
  it("stay within 200 to 300 ms, growing with distance", () => {
    expect(durationForDistance(0)).toBe(MIN_DURATION_MS);
    expect(durationForDistance(100)).toBeGreaterThan(MIN_DURATION_MS);
    expect(durationForDistance(10_000)).toBe(MAX_DURATION_MS);
    expect(MIN_DURATION_MS).toBeGreaterThanOrEqual(200);
    expect(MAX_DURATION_MS).toBeLessThanOrEqual(300);
  });
  it("shorten when keys repeat quickly", () => {
    expect(retargetDuration(400)).toBe(RETARGET_DURATION_MS);
    expect(retargetDuration(30)).toBe(REPEAT_DURATION_MS);
    expect(REPEAT_DURATION_MS).toBeLessThan(RETARGET_DURATION_MS);
  });
});

describe("smoothScrollTo", () => {
  it("honours a caller-chosen duration for a fresh glide and never slows a retarget", () => {
    const el = fakeScroller();
    smoothScrollTo(el, { top: 1000 }, undefined, { duration: 160 });
    for (let i = 0; i < 12; i += 1) advance(16);
    // 12 frames of 16 ms is 192 ms: a 160 ms glide has landed (the default 200 to 280 ms one would not).
    expect(el.scrollTop).toBe(1000);
    expect(isSmoothScrolling(el)).toBe(false);
    smoothScrollTo(el, { top: 0 }, undefined, { duration: 160 });
    advance(16);
    smoothScrollTo(el, { top: 500 }, undefined, { duration: 400 });
    for (let i = 0; i < 12; i += 1) advance(16);
    expect(el.scrollTop).toBe(500);
  });

  it("eases monotonically in several steps and lands exactly on the target", () => {
    const el = fakeScroller();
    smoothScrollTo(el, { top: 400 });
    expect(isSmoothScrolling(el)).toBe(true);
    for (let i = 0; i < 30 && isSmoothScrolling(el); i += 1) advance(16);
    expect(el.scrollTop).toBe(400);
    expect(isSmoothScrolling(el)).toBe(false);
    expect(el.writes.length).toBeGreaterThanOrEqual(8);
    expect(el.writes.every((v, i) => i === 0 || v >= el.writes[i - 1]!)).toBe(true);
    expect(Math.max(...el.writes)).toBe(400);
  });

  it("retargets from the current position without overshoot or stall", () => {
    const el = fakeScroller();
    smoothScrollTo(el, { top: 400 });
    advance(16);
    advance(16);
    const mid = el.scrollTop;
    expect(mid).toBeGreaterThan(0);
    smoothScrollTo(el, { top: 800 });
    expect(settledScrollOffset(el, "top")).toBe(800);
    advance(16);
    expect(el.scrollTop).toBeGreaterThan(mid);
    for (let i = 0; i < 30 && isSmoothScrolling(el); i += 1) advance(16);
    expect(el.scrollTop).toBe(800);
    expect(Math.max(...el.writes)).toBe(800);
    expect(el.writes.every((v, i) => i === 0 || v >= el.writes[i - 1]!)).toBe(true);
  });

  it("never queues a backlog under a held key: one animation, newest target", () => {
    const el = fakeScroller();
    for (let i = 1; i <= 20; i += 1) {
      smoothScrollTo(el, { top: i * 100 });
      advance(33);
    }
    expect(frames.filter((f) => f).length).toBeLessThanOrEqual(1);
    for (let i = 0; i < 30 && isSmoothScrolling(el); i += 1) advance(16);
    expect(el.scrollTop).toBe(2000);
  });

  it("ignores a repeat of the destination already in flight", () => {
    const el = fakeScroller();
    smoothScrollTo(el, { top: 300 });
    advance(16);
    const pending = frames.length;
    smoothScrollTo(el, { top: 300 });
    expect(frames.length).toBe(pending);
  });

  it("cancels and leaves the scroller where it is", () => {
    const el = fakeScroller();
    smoothScrollTo(el, { top: 400 });
    advance(32);
    const at = el.scrollTop;
    cancelSmoothScroll(el);
    expect(isSmoothScrolling(el)).toBe(false);
    advance(100);
    expect(el.scrollTop).toBe(at);
  });

  it("yields when the user scrolls the element away", () => {
    const el = fakeScroller();
    smoothScrollTo(el, { top: 400 });
    advance(32);
    el.scrollTop = 900;
    advance(16);
    expect(isSmoothScrolling(el)).toBe(false);
    expect(el.scrollTop).toBe(900);
  });

  it("jumps straight there under reduced motion", () => {
    (window as unknown as { matchMedia: () => { matches: boolean } }).matchMedia = () => ({ matches: true });
    const el = fakeScroller();
    smoothScrollTo(el, { top: 400 });
    expect(el.scrollTop).toBe(400);
    expect(isSmoothScrolling(el)).toBe(false);
  });
});

describe("instant helpers", () => {
  it("setScrollInstant cancels a glide; holdScroll leaves one alone", () => {
    const el = fakeScroller();
    smoothScrollTo(el, { top: 400 });
    advance(16);
    holdScroll(el, { top: 0 });
    expect(isSmoothScrolling(el)).toBe(true);
    setScrollInstant(el, { top: 50 });
    expect(isSmoothScrolling(el)).toBe(false);
    expect(el.scrollTop).toBe(50);
  });
});

describe("setScrollInstant and CSS scroll-behavior", () => {
  it("writes with scroll-behavior auto (a smooth CSS scroller would glide) and hands the property back", () => {
    const el = fakeScroller();
    setScrollInstant(el, { top: 500 });
    expect(el.behaviourAtWrite).toEqual(["auto"]);
    // Nothing left set once no glide is running, so the stylesheet's own behaviour applies again.
    expect(isSmoothScrolling(el)).toBe(false);
  });

  it("keeps auto while a glide on the other axis is still running", () => {
    const el = fakeScroller();
    smoothScrollTo(el, { left: 300 });
    advance(16);
    setScrollInstant(el, { top: 40 });
    expect(el.behaviourAtWrite.at(-1)).toBe("auto");
    expect(isSmoothScrolling(el)).toBe(true);
  });
});

describe("revealDelta", () => {
  it("is zero when already inside, signed when clipped, and centres on request", () => {
    expect(revealDelta(100, 200, 0, 500, "nearest")).toBe(0);
    expect(revealDelta(-40, 20, 0, 500, "nearest")).toBe(-40);
    expect(revealDelta(450, 600, 0, 500, "nearest")).toBe(100);
    expect(revealDelta(400, 500, 0, 500, "center")).toBe(200);
  });
});

describe("scroll profile (velocity-preserving glide)", () => {
  const profile = {
    freshMs: 380,
    retargetMs: 320,
    repeatMs: 240,
    repeatWindowMs: 160,
    restSlope: 2,
  };

  function horizontal(): FakeScroller & { left: number } {
    let left = 0;
    const el = fakeScroller() as FakeScroller & { left: number };
    Object.defineProperty(el, "scrollLeft", {
      get: () => left,
      set: (v: number) => {
        left = v;
      },
    });
    Object.defineProperty(el, "left", { get: () => left });
    return el;
  }

  it("glides one step monotonically, without overshoot, in the fresh duration", () => {
    const el = horizontal();
    smoothScrollTo(el, { left: 200 }, profile);
    const seen: number[] = [];
    for (let i = 0; i < 40; i += 1) {
      advance(10);
      seen.push(el.left);
    }
    expect(seen.every((v, i) => i === 0 || v >= seen[i - 1]! - 1e-9)).toBe(true);
    expect(Math.max(...seen)).toBeLessThanOrEqual(200);
    expect(seen[Math.round(380 / 10) - 2]!).toBeLessThan(200);
    expect(seen[Math.round(380 / 10)]!).toBe(200);
  });

  it("retargets from the current position and keeps its speed", () => {
    const el = horizontal();
    smoothScrollTo(el, { left: 200 }, profile);
    for (let i = 0; i < 10; i += 1) advance(10);
    const p1 = el.left;
    advance(10);
    const v1 = el.left - p1;
    smoothScrollTo(el, { left: 400 }, profile);
    const atPress = el.left;
    expect(atPress).toBe(p1 + v1);
    advance(10);
    const v2 = el.left - atPress;
    // Same position at the press (no reset to the start) and about the same speed straight after it.
    expect(el.left).toBeGreaterThan(atPress);
    expect(v2 / v1).toBeGreaterThan(0.7);
    expect(v2 / v1).toBeLessThan(2);
    for (let i = 0; i < 60; i += 1) advance(10);
    expect(el.left).toBe(400);
  });

  it("ignores stock calls on an owned axis but still honours instant jumps", () => {
    const el = horizontal();
    const release = ownHorizontalScroll(el);
    smoothScrollTo(el, { left: 300 });
    expect(isSmoothScrolling(el)).toBe(false);
    setScrollInstant(el, { left: 50 });
    expect(el.left).toBe(50);
    release();
    smoothScrollTo(el, { left: 300 });
    expect(isSmoothScrolling(el)).toBe(true);
  });

  it("calls onFrame with every written value", () => {
    const el = horizontal();
    const values: number[] = [];
    smoothScrollTo(el, { left: 100 }, { ...profile, onFrame: (v) => values.push(v) });
    for (let i = 0; i < 40; i += 1) advance(10);
    expect(values.at(-1)).toBe(100);
    expect(values.length).toBeGreaterThan(10);
  });
});

describe("scroll profile frame timing", () => {
  it("never moves backwards when a frame timestamp predates the glide start", () => {
    let left = 0;
    const el = fakeScroller();
    Object.defineProperty(el, "scrollLeft", { get: () => left, set: (v: number) => { left = v; } });
    smoothScrollTo(el, { left: 200 }, { freshMs: 380, retargetMs: 320, repeatMs: 240, repeatWindowMs: 160, restSlope: 2 });
    advance(-20);
    expect(left).toBeGreaterThanOrEqual(0);
  });
});
