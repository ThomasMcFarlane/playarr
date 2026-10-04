import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mapChangeToInvalidations } from "./mapping";
import { createLiveRegistry } from "./registry";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
});
afterEach(() => vi.useRealTimers());

const change = (type: string, entity: string, id: string | undefined, changed: string[]) =>
  mapChangeToInvalidations({ type, entity, id, changed });

describe("mapChangeToInvalidations", () => {
  it("maps each contract event type to its consumer area", () => {
    expect(change("watch", "work", "w1", ["progress"])).toEqual([{ area: "progress", key: "w1" }]);
    expect(change("library", "work", "w1", ["files"])).toEqual([{ area: "catalog", key: "w1" }]);
    expect(change("calendar", "work", "w1", ["imported"])).toEqual([{ area: "calendar", key: "w1" }]);
    expect(change("playlist", "playlist", "p1", ["items"])).toEqual([{ area: "playlists", key: "p1" }]);
    expect(change("watchlist", "watchlist", "t1", ["added"])).toEqual([{ area: "watchlist", key: "t1" }]);
    expect(change("download", "download", "d1", ["status"])).toEqual([{ area: "downloads", key: "d1" }]);
    expect(change("household", "profile", "u1", ["policy"])).toEqual([{ area: "household", key: "u1" }]);
    expect(change("admin", "source_instance", "s1", ["sync_finished"])).toEqual([{ area: "admin", key: "s1" }]);
  });

  it("turns bulk / wildcard into a whole-area invalidation", () => {
    expect(change("library", "*", undefined, ["bulk"])).toEqual([{ area: "catalog", key: undefined }]);
    expect(change("library", "work", "w1", ["bulk"])).toEqual([{ area: "catalog", key: undefined }]);
  });

  it("account changes refresh capabilities, household and the catalogue", () => {
    expect(change("account", "profile", "u1", ["policy"]).map((i) => i.area)).toEqual([
      "account",
      "household",
      "catalog",
    ]);
  });

  it("ignores unknown types", () => {
    expect(change("future", "thing", "x", [])).toEqual([]);
  });
});

describe("live registry", () => {
  it("refetches only consumers of the touched work (precision)", () => {
    const registry = createLiveRegistry();
    const a = vi.fn();
    const b = vi.fn();
    const list = vi.fn();
    const calendar = vi.fn();
    registry.register({ areas: ["progress"], keys: ["A"] }, a);
    registry.register({ areas: ["progress"], keys: ["B"] }, b);
    registry.register({ areas: ["progress"] }, list);
    registry.register({ areas: ["calendar"] }, calendar);
    vi.advanceTimersByTime(10);
    registry.invalidate([{ area: "progress", key: "A" }], 1_000_005);
    vi.advanceTimersByTime(300);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).not.toHaveBeenCalled();
    expect(list).toHaveBeenCalledTimes(1);
    expect(calendar).not.toHaveBeenCalled();
  });

  it("a whole-area invalidation reaches keyed consumers too", () => {
    const registry = createLiveRegistry();
    const b = vi.fn();
    registry.register({ areas: ["catalog"], keys: ["B"] }, b);
    vi.advanceTimersByTime(10);
    registry.invalidate([{ area: "catalog" }], 1_000_050);
    vi.advanceTimersByTime(300);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it("coalesces a burst into one trailing refetch per consumer", () => {
    const registry = createLiveRegistry({ debounceMs: 200 });
    const list = vi.fn();
    registry.register({ areas: ["progress"] }, list);
    vi.advanceTimersByTime(10);
    for (let i = 0; i < 20; i += 1) {
      registry.invalidate([{ area: "progress", key: `w${i}` }], 1_000_100 + i);
      vi.advanceTimersByTime(50);
    }
    expect(list).toHaveBeenCalledTimes(1); // max-wait flush at 1 s
    vi.advanceTimersByTime(500);
    expect(list.mock.calls.length).toBeLessThanOrEqual(2);
  });

  it("waits for a quiet gap before the trailing refetch", () => {
    const registry = createLiveRegistry({ debounceMs: 200 });
    const fn = vi.fn();
    registry.register({ areas: ["calendar"] }, fn);
    vi.advanceTimersByTime(10);
    registry.invalidate([{ area: "calendar", key: "w" }], 1_000_020);
    vi.advanceTimersByTime(199);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("drops events not newer than the data already fetched", () => {
    const registry = createLiveRegistry();
    const fn = vi.fn();
    registry.register({ areas: ["progress"] }, fn); // fetchedAt = 1_000_000
    registry.invalidate([{ area: "progress", key: "w" }], 999_000);
    registry.invalidate([{ area: "progress", key: "w" }], 1_000_000);
    vi.advanceTimersByTime(300);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    registry.invalidate([{ area: "progress", key: "w" }], 1_000_500);
    vi.advanceTimersByTime(300);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("unregisters and refetchAll reaches every mounted consumer immediately", () => {
    const registry = createLiveRegistry();
    const one = vi.fn();
    const two = vi.fn();
    const off = registry.register({ areas: ["admin"] }, one);
    registry.register({ areas: ["playlists"], keys: ["p"] }, two);
    off();
    registry.refetchAll();
    expect(one).not.toHaveBeenCalled();
    expect(two).toHaveBeenCalledTimes(1);
    expect(registry.size()).toBe(1);
  });
});
