import { describe, expect, it } from "vitest";
import type { ResumeOption, ResumePlan, SeasonDetail, WorkDetail } from "@playarr-tv/api-client";
import {
  formatLastWatched,
  isStackedPlan,
  nextUpSelection,
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

describe("nextUpSelection (the tile a series page opens on)", () => {
  function season(number: number, episodes: Array<[string, string | null]>): SeasonDetail {
    return {
      season: { season_number: number },
      episodes: episodes.map(([id, media], index) => ({
        episode: { id, episode_number: index + 1 },
        media_file_id: media,
      })),
    } as unknown as SeasonDetail;
  }
  const seasons = [
    season(1, [["e11", "m11"], ["e12", "m12"], ["e13", "m13"]]),
    season(2, [["e21", "m21"], ["e22", "m22"]]),
  ];

  it("points at the episode the Play button resumes, in a later season", () => {
    const resume = plan({
      target: option({ episode_id: "e21", media_file_id: "m21", season_number: 2, episode_number: 1 }),
    });
    expect(nextUpSelection(seasons, resume, "s")).toEqual({ seasonNumber: 2, episodeId: "e21" });
  });

  it("opens on the first playable episode when nothing was watched", () => {
    const start = plan({
      action: "start",
      target: option({ episode_id: "e11", media_file_id: "m11", season_number: 1, episode_number: 1 }),
    });
    expect(nextUpSelection(seasons, start, "s")).toEqual({ seasonNumber: 1, episodeId: "e11" });
  });

  it("skips episodes without a media file when choosing the first one", () => {
    const sparse = [season(1, [["e11", null], ["e12", "m12"]]), season(2, [["e21", "m21"]])];
    expect(nextUpSelection(sparse, null, "s")).toEqual({ seasonNumber: 1, episodeId: "e12" });
  });

  it("follows the plan for a fully watched series (Watch again target)", () => {
    const again = plan({
      action: "restart",
      target: option({ episode_id: "e11", media_file_id: "m11", season_number: 1, episode_number: 1 }),
    });
    expect(nextUpSelection(seasons, again, "s")).toEqual({ seasonNumber: 1, episodeId: "e11" });
    const lastAgain = plan({
      action: "restart",
      target: option({ episode_id: "e22", media_file_id: "m22", season_number: 2, episode_number: 2 }),
    });
    expect(nextUpSelection(seasons, lastAgain, "s")).toEqual({ seasonNumber: 2, episodeId: "e22" });
  });

  it("matches by media file when the episode id is unknown", () => {
    const byFile = plan({
      target: option({ episode_id: "other", media_file_id: "m12", season_number: 1, episode_number: 2 }),
    });
    expect(nextUpSelection(seasons, byFile, "s")).toEqual({ seasonNumber: 1, episodeId: "e12" });
  });

  it("falls back to the first episode without a plan, for another series, or for an unknown target", () => {
    const first = { seasonNumber: 1, episodeId: "e11" };
    expect(nextUpSelection(seasons, null, "s")).toEqual(first);
    expect(nextUpSelection(seasons, undefined, "s")).toEqual(first);
    expect(nextUpSelection(seasons, plan({ series_work_id: "other" }), "s")).toEqual(first);
    expect(
      nextUpSelection(seasons, plan({ target: option({ episode_id: "gone", media_file_id: "gone" }) }), "s")
    ).toEqual(first);
    expect(nextUpSelection(seasons, plan({ target: null }), "s")).toEqual(first);
  });

  it("is null for a series with nothing playable", () => {
    expect(nextUpSelection([], plan(), "s")).toBeNull();
    expect(nextUpSelection([season(1, [["e11", null]])], plan(), "s")).toBeNull();
  });
});
