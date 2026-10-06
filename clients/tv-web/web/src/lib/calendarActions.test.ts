import type { CalendarAction, CalendarEntry, TitleSnapshot } from "@playarr-tv/api-client";
import { describe, expect, it } from "vitest";
import { legacySnapshot, planCalendarActions } from "./calendarActions";

const snapshot: TitleSnapshot = {
  kind: "series",
  title: "Sample Series 1",
  year: 2026,
  work_id: null,
  external_refs: [{ provider: "tvdb", external_id: "123" }],
  poster_url: null,
};

function entry(actions: CalendarAction[] | undefined, extra: Partial<CalendarEntry> = {}): CalendarEntry {
  return {
    id: "e1",
    media_kind: "episode",
    release_type: "air",
    title: "Sample Series 1",
    date: "2026-10-08",
    monitored: true,
    has_file: false,
    sources: [],
    snapshot,
    actions,
    ...extra,
  };
}

describe("planCalendarActions", () => {
  it("is legacy for a server that sends no actions", () => {
    const plan = planCalendarActions(entry(undefined, { snapshot: undefined }));
    expect(plan.legacy).toBe(true);
    expect(plan.open).toBeNull();
    expect(plan.snapshot).toBeNull();
  });

  it("offers play and open for a library title, from the server's work and file", () => {
    const plan = planCalendarActions(
      entry([
        { action: "open", enabled: true, work_id: "w1" },
        { action: "play", enabled: true, work_id: "w1", media_file_id: "f1" },
      ]),
    );
    expect(plan.legacy).toBe(false);
    expect(plan.open).toEqual({ route: "/series/w1" });
    expect(plan.play).toEqual({ mediaFileId: "f1", resume: false });
    expect(plan.request).toBeNull();
  });

  it("prefers resume and still opens the title when only resume is listed", () => {
    const plan = planCalendarActions(
      entry([{ action: "resume", enabled: true, work_id: "w9", media_file_id: "f9", position_ms: 5000 }], { media_kind: "movie" }),
    );
    expect(plan.play).toEqual({ mediaFileId: "f9", resume: true });
    expect(plan.open).toEqual({ route: "/movies/w9" });
  });

  it("keeps request and watchlist for a title outside the library and passes the snapshot through unchanged", () => {
    const plan = planCalendarActions(
      entry([
        { action: "request", enabled: true },
        { action: "watchlist", enabled: true, active: true },
      ]),
    );
    expect(plan.open).toBeNull();
    expect(plan.play).toBeNull();
    expect(plan.request).toEqual({ enabled: true, reason: null, requested: false });
    expect(plan.watchlist).toEqual({ enabled: true, reason: null, listed: true });
    expect(plan.snapshot).toBe(snapshot);
  });

  it("keeps the server's reason for a disabled request and treats an existing request as requested", () => {
    const denied = planCalendarActions(entry([{ action: "request", enabled: false, reason: "Requests are not enabled for your account" }]));
    expect(denied.request).toEqual({ enabled: false, reason: "Requests are not enabled for your account", requested: false });
    const requested = planCalendarActions(entry([{ action: "request", enabled: false, active: true, reason: "Already requested" }]));
    expect(requested.request?.requested).toBe(true);
  });

  it("does not offer a disabled open or a play without a file", () => {
    const plan = planCalendarActions(
      entry([
        { action: "open", enabled: false, reason: "No access" },
        { action: "play", enabled: true, work_id: "w1" },
      ]),
    );
    expect(plan.open).toBeNull();
    expect(plan.play).toBeNull();
  });
});

describe("legacySnapshot", () => {
  it("maps media kinds to discovery kinds for servers without snapshots", () => {
    expect(legacySnapshot(entry(undefined, { media_kind: "movie" })).kind).toBe("movie");
    expect(legacySnapshot(entry(undefined, { media_kind: "album" })).kind).toBe("artist");
    expect(legacySnapshot(entry(undefined)).year).toBe(2026);
  });
});
