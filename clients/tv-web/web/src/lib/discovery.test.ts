import { describe, expect, it } from "vitest";
import type { DiscoveryTitle, TitleAction, Work } from "@playarr-tv/api-client";
import {
  discoveryUnsupportedByServer,
  explainedDisabledActions,
  extraTitles,
  libraryDetailRoute,
  playerTargetFor,
  primaryAction,
  snapshotFromTitle,
  snapshotFromWork,
  uniqueSourceKinds,
} from "./discovery";

function action(partial: Partial<TitleAction> & Pick<TitleAction, "action">): TitleAction {
  return { enabled: true, ...partial } as TitleAction;
}

function title(partial: Partial<DiscoveryTitle>): DiscoveryTitle {
  return {
    title_key: "tmdb:movie:1",
    kind: "movie",
    title: "Orbit",
    external_refs: [],
    editions: [],
    sources: [],
    ...partial,
  } as DiscoveryTitle;
}

describe("primaryAction", () => {
  it("prefers resume over play and skips disabled actions", () => {
    const actions = [
      action({ action: "play" }),
      action({ action: "resume", media_file_id: "f1" }),
      action({ action: "record", enabled: false, reason: "later" }),
    ];
    expect(primaryAction(actions)?.action).toBe("resume");
  });

  it("falls back to request when nothing is playable", () => {
    const actions = [
      action({ action: "play", enabled: false, reason: "Not in a library you can access" }),
      action({ action: "request" }),
    ];
    expect(primaryAction(actions)?.action).toBe("request");
  });

  it("returns null when every action is disabled", () => {
    expect(primaryAction([action({ action: "play", enabled: false, reason: "x" })])).toBeNull();
  });
});

describe("explainedDisabledActions", () => {
  it("lists disabled actions that carry a reason", () => {
    const list = explainedDisabledActions([
      action({ action: "play" }),
      action({ action: "request", enabled: false, reason: "No request provider is configured" }),
      action({ action: "record", enabled: false, reason: "Recording is not available yet" }),
    ]);
    expect(list.map((a) => a.action)).toEqual(["request"]);
  });

  it("never explains Record (developer text)", () => {
    const list = explainedDisabledActions([
      action({ action: "record", enabled: false, reason: "Recording is not available yet" }),
    ]);
    expect(list).toEqual([]);
  });
});

describe("snapshots and routes", () => {
  it("keeps the library work id and routes by kind", () => {
    const t = title({
      kind: "series",
      sources: [
        { source: "library", label: "Library", availability: "available", work_id: "w1" },
        { source: "peer", label: "Den", availability: "available" },
      ],
    });
    expect(snapshotFromTitle(t).work_id).toBe("w1");
    expect(libraryDetailRoute(t)).toBe("/series/w1");
    expect(uniqueSourceKinds(t.sources)).toEqual(["library", "peer"]);
  });

  it("has no detail route without a library source", () => {
    expect(libraryDetailRoute(title({ sources: [] }))).toBeNull();
  });

  it("builds a snapshot from a work with poster and year", () => {
    const work = {
      id: "w9",
      kind: "movie",
      title: "Orbit",
      external_refs: [{ provider: "tmdb", external_id: "949" }],
      images: [{ kind: "poster", url: "https://img/p.jpg" }],
      release_date: "1995-12-15T00:00:00Z",
    } as unknown as Work;
    expect(snapshotFromWork(work)).toMatchObject({
      kind: "movie",
      year: 1995,
      work_id: "w9",
      poster_url: "https://img/p.jpg",
    });
  });
});

describe("extraTitles", () => {
  it("keeps non-library and game titles only", () => {
    const lib = title({
      title_key: "a",
      sources: [{ source: "library", label: "Library", availability: "available" }],
    });
    const peer = title({
      title_key: "b",
      sources: [{ source: "peer", label: "Den", availability: "available" }],
    });
    const game = title({ title_key: "c", kind: "game", sources: [] });
    expect(extraTitles([lib, peer, game]).map((t) => t.title_key)).toEqual(["b", "c"]);
  });
});

describe("playerTargetFor", () => {
  it("opens the file of an enabled action only", () => {
    expect(playerTargetFor(action({ action: "play", media_file_id: "f1" }))).toBe("/player/f1");
    expect(playerTargetFor(action({ action: "play", enabled: false, media_file_id: "f1" }))).toBeNull();
    expect(playerTargetFor(action({ action: "request" }))).toBeNull();
  });
});

describe("discoveryUnsupportedByServer", () => {
  it("recognises html fallbacks and missing routes from older servers", () => {
    expect(discoveryUnsupportedByServer(new SyntaxError("Unexpected token <"))).toBe(true);
    expect(discoveryUnsupportedByServer({ status: 404 })).toBe(true);
    expect(discoveryUnsupportedByServer({ status: 500 })).toBe(false);
    expect(discoveryUnsupportedByServer(new Error("boom"))).toBe(false);
  });
});
