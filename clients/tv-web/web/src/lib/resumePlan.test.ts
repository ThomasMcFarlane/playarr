import { describe, expect, it } from "vitest";
import type { ResumeOption, ResumePlan, WorkDetail } from "@playarr-tv/api-client";
import {
  formatLastWatched,
  isStackedPlan,
  resumeButtonLabelKey,
  resumeButtonTitleKey,
  resumeOptionCaptionKey,
  resumePlayerState,
  seriesPlaylist,
} from "./resumePlan";

const t = (key: string, params?: Record<string, string | number>) =>
  `${key}${params ? JSON.stringify(params) : ""}`;

function option(overrides: Partial<ResumeOption> = {}): ResumeOption {
  return {
    kind: "next_in_series",
    episode_id: "e2",
    media_file_id: "m2",
    season_number: 1,
    episode_number: 2,
    label: "S01E02",
    title: "Second",
    position_ms: 0,
    duration_ms: 1_800_000,
    progress_percent: 0,
    ...overrides,
  };
}

function plan(overrides: Partial<ResumePlan> = {}): ResumePlan {
  const o = option();
  return {
    series_work_id: "s",
    action: "resume",
    reason: "next_in_order",
    needs_choice: false,
    ask_reasons: [],
    target: o,
    options: [o],
    ...overrides,
  };
}

describe("resume button labels", () => {
  it("maps each action to its label and title keys", () => {
    expect(resumeButtonLabelKey(plan({ action: "start" }))).toBe("pages.workDetail.startSeries");
    expect(resumeButtonLabelKey(plan({ action: "resume" }))).toBe("pages.workDetail.resumeSeries");
    expect(resumeButtonLabelKey(plan({ action: "restart" }))).toBe("pages.workDetail.watchAgain");
    expect(resumeButtonTitleKey(plan({ action: "start" }))).toBe(
      "pages.workDetail.startSeriesTitle"
    );
    expect(resumeButtonTitleKey(plan({ action: "restart" }))).toBe(
      "pages.workDetail.watchAgainTitle"
    );
  });
});

describe("option captions", () => {
  it("has a caption for every option kind", () => {
    const kinds = [
      "unfinished",
      "missed_episode",
      "continue_from_last_watched",
      "next_in_series",
      "start_over",
    ] as const;
    const keys = kinds.map(resumeOptionCaptionKey);
    expect(new Set(keys).size).toBe(kinds.length);
  });
});

describe("isStackedPlan", () => {
  it("is true only when a choice is needed among several options", () => {
    expect(isStackedPlan(undefined)).toBe(false);
    expect(isStackedPlan(plan())).toBe(false);
    const two = [option(), option({ kind: "missed_episode", episode_id: "e1" })];
    expect(isStackedPlan(plan({ needs_choice: true, options: two }))).toBe(true);
    expect(isStackedPlan(plan({ needs_choice: true, options: [option()] }))).toBe(false);
  });
});

describe("formatLastWatched", () => {
  it("formats valid stamps and rejects missing or invalid ones", () => {
    expect(formatLastWatched("2026-10-04T12:00:00Z", "en")).toMatch(/2026/);
    expect(formatLastWatched(undefined, "en")).toBeNull();
    expect(formatLastWatched("nope", "en")).toBeNull();
  });
});

describe("seriesPlaylist", () => {
  it("orders by season and episode and skips episodes without a file", () => {
    const ep = (id: string, n: number, file: string | null) => ({
      episode: { id, episode_number: n, title: n === 3 ? null : `T${n}` },
      media_file_id: file,
    });
    const detail = {
      work: { id: "w", title: "Show", kind: "series" },
      children: {
        Series: [
          { season: { season_number: 2 }, episodes: [ep("b1", 1, "mb1")] },
          {
            season: { season_number: 1 },
            episodes: [ep("a3", 3, "ma3"), ep("a1", 1, "ma1"), ep("a2", 2, null)],
          },
        ],
      },
    } as unknown as WorkDetail;
    const items = seriesPlaylist(detail, t);
    expect(items.map((i) => i.mediaFileId)).toEqual(["ma1", "ma3", "mb1"]);
    expect(items[1]?.title).toContain("episodeNumber");
    expect(items[0]).toMatchObject({ seasonNumber: 1, episodeNumber: 1, subtitle: "Show" });
  });

  it("returns nothing for a non-series tree", () => {
    expect(seriesPlaylist({ work: {}, children: "Movie" } as unknown as WorkDetail, t)).toEqual([]);
  });
});

describe("resumePlayerState", () => {
  it("targets the option's file and episode with the series playlist", () => {
    const items = [{ mediaFileId: "m2", title: "Second" }];
    const state = resumePlayerState(option(), "Show", items, { backTo: "/series/s" }, t);
    expect(state.mediaFileId).toBe("m2");
    expect(state.episodeId).toBe("e2");
    expect(state.playlistItems).toBe(items);
    expect(state.backTo).toBe("/series/s");
    expect(state.title).toContain("Show");
    expect(state.title).toContain("Second");
  });

  it("falls back to the episode number when the title is unknown", () => {
    const state = resumePlayerState(option({ title: null }), "Show", [], {}, t);
    expect(state.title).toContain("episodeNumber");
  });
});
