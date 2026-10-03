import { describe, expect, it } from "vitest";
import {
  END_SCREEN_COUNTDOWN_SECONDS,
  END_SCREEN_MAX_SUGGESTIONS,
  detailRouteForWork,
  pickSuggestions,
  replayNegotiationParams,
  resolveEndScreenKind,
  workIdFromDetailRoute,
} from "./endScreen";

const base = {
  engineState: "ended",
  minimised: false,
  inlineMusic: false,
  isMusic: false,
  hasNext: false,
};

describe("resolveEndScreenKind", () => {
  it("shows the ended card for a lone video", () => {
    expect(resolveEndScreenKind(base)).toBe("ended");
  });
  it("shows up-next when a next item exists", () => {
    expect(resolveEndScreenKind({ ...base, hasNext: true })).toBe("up-next");
  });
  it("shows nothing before the end or when minimised", () => {
    expect(resolveEndScreenKind({ ...base, engineState: "playing" })).toBeNull();
    expect(resolveEndScreenKind({ ...base, minimised: true })).toBeNull();
  });
  it("chains music silently and only shows the ended card at queue end", () => {
    expect(resolveEndScreenKind({ ...base, isMusic: true, hasNext: true })).toBeNull();
    expect(resolveEndScreenKind({ ...base, isMusic: true })).toBe("ended");
  });
  it("leaves inline mobile music to its mini player", () => {
    expect(resolveEndScreenKind({ ...base, isMusic: true, inlineMusic: true })).toBeNull();
  });
});

describe("helpers", () => {
  it("uses a 10 second countdown", () => {
    expect(END_SCREEN_COUNTDOWN_SECONDS).toBe(10);
  });
  it("parses the work id from detail routes only", () => {
    expect(workIdFromDetailRoute("/series/abc")).toBe("abc");
    expect(workIdFromDetailRoute("/search/abc")).toBeUndefined();
    expect(workIdFromDetailRoute(undefined)).toBeUndefined();
  });
  it("maps work kinds to detail routes", () => {
    expect(detailRouteForWork({ id: "1", kind: "series" })).toBe("/series/1");
    expect(detailRouteForWork({ id: "2", kind: "movie" })).toBe("/movies/2");
    expect(detailRouteForWork({ id: "3", kind: "site" })).toBe("/sites/3");
  });
  it("drops the finished work and caps suggestions", () => {
    const works = Array.from({ length: 20 }, (_, i) => ({ id: String(i), kind: "movie" }));
    const picked = pickSuggestions(works, "0");
    expect(picked).toHaveLength(END_SCREEN_MAX_SUGGESTIONS);
    expect(picked.some((w) => w.id === "0")).toBe(false);
    expect(pickSuggestions([{ id: "a", kind: "album" }], undefined)).toEqual([]);
  });
  it("replay renegotiates from position 0 without mutating the previous request", () => {
    const previous = { startPositionMs: 91_000, profile: "720p" };
    expect(replayNegotiationParams(previous)).toEqual({ startPositionMs: 0, profile: "720p" });
    expect(previous.startPositionMs).toBe(91_000);
  });
});
