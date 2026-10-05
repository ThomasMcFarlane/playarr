import { describe, expect, it } from "vitest";
import {
  activeActivityFilterCount,
  activityFiltersEqual,
  emptyActivityFilters,
  fromLocalDateTimeValue,
  matchesLiveActivityFilters,
  parseActivityFilters,
  recentActivityRange,
  serialiseActivityFilters,
  toActivityHistoryRequest,
  validateActivityFilters,
  type ActivityFilters,
} from "./activityFilters";

describe("activity filter URL state", () => {
  it("parses valid repeated facets and preserves datetime precision", () => {
    const filters = parseActivityFilters(
      new URLSearchParams(
        "user_id=user-b&user_id=user-a&user_id=user-b" +
          "&play_method=transcode&play_method=invalid" +
          "&title=Test Series I&library_id=library-a&peer_node_id=peer-a" +
          "&from=2026-07-29T10%3A34%3A59.987Z" +
          "&to=2026-07-29T11%3A34%3A02.123Z" +
          "&min_duration_ms=120000&max_bytes_streamed=invalid" +
          "&stop_reason=completed&stop_reason=invalid"
      )
    );

    expect(filters).toMatchObject({
      userIds: ["user-b", "user-a"],
      playMethods: ["transcode"],
      titleTerms: ["Test Series I"],
      libraryIds: ["library-a"],
      peerNodeIds: ["peer-a"],
      from: "2026-07-29T10:34:59.987Z",
      to: "2026-07-29T11:34:02.123Z",
      minDurationMs: 120_000,
      stopReasons: ["completed"],
    });
    expect(filters.maxBytesStreamed).toBeUndefined();
  });

  it("preserves unrelated query state and writes facets canonically", () => {
    const filters = {
      ...emptyActivityFilters(),
      userIds: ["user-b", "user-a"],
      titleTerms: ["Zulu", "Alpha"],
      minBytesStreamed: 1024,
    };
    const params = serialiseActivityFilters(
      filters,
      new URLSearchParams("apiBaseUrl=https%3A%2F%2Fexample.test")
    );

    expect(params.get("apiBaseUrl")).toBe("https://example.test");
    expect(params.getAll("user_id")).toEqual(["user-a", "user-b"]);
    expect(params.getAll("title")).toEqual(["Alpha", "Zulu"]);
    expect(params.get("min_bytes_streamed")).toBe("1024");
  });

  it("compares multi-value facets without depending on selection order", () => {
    const left: ActivityFilters = {
      ...emptyActivityFilters(),
      userIds: ["user-b", "user-a"],
      stopReasons: ["error", "completed"],
    };
    const right: ActivityFilters = {
      ...emptyActivityFilters(),
      userIds: ["user-a", "user-b"],
      stopReasons: ["completed", "error"],
    };

    expect(activityFiltersEqual(left, right)).toBe(true);
  });
});

describe("activity filter request and validation", () => {
  it("builds the generated snake-case request without empty facets", () => {
    const request = toActivityHistoryRequest(
      {
        ...emptyActivityFilters(),
        playMethods: ["direct_play", "transcode"],
        peerNodeIds: ["peer-a"],
        minDurationMs: 60_000,
        maxBytesStreamed: 1_000_000,
      },
      { limit: 100, cursor: "opaque-cursor" }
    );

    expect(request).toEqual({
      user_ids: undefined,
      play_methods: ["direct_play", "transcode"],
      title_terms: undefined,
      library_ids: undefined,
      peer_node_ids: ["peer-a"],
      from: undefined,
      to: undefined,
      min_duration_ms: 60_000,
      max_duration_ms: undefined,
      stop_reasons: undefined,
      min_bytes_streamed: undefined,
      max_bytes_streamed: 1_000_000,
      limit: 100,
      cursor: "opaque-cursor",
    });
  });

  it("counts applied facets rather than individual selected values", () => {
    expect(
      activeActivityFilterCount({
        ...emptyActivityFilters(),
        userIds: ["user-a", "user-b"],
        titleTerms: ["Test Series I"],
        from: "2026-07-29T10:00:00.000Z",
        to: "2026-07-29T11:00:00.000Z",
      })
    ).toBe(3);
  });

  it("uses field names and inclusive ordering in date validation", () => {
    const equal = "2026-07-29T10:00:00.000Z";
    expect(
      validateActivityFilters({
        ...emptyActivityFilters(),
        from: equal,
        to: equal,
      }).dateRange
    ).toBeUndefined();

    expect(
      validateActivityFilters({
        ...emptyActivityFilters(),
        from: "2026-07-29T11:00:00.000Z",
        to: equal,
      }).dateRange
    ).toBe(
      "The From date and time must not be later than the To date and time."
    );
  });

  it("normalises manual input while recent presets use the exact instant", () => {
    expect(fromLocalDateTimeValue("2026-07-29T10:34:59")).toMatch(
      /:34:00\.000Z$/
    );
    expect(
      fromLocalDateTimeValue("2026-07-29T10:34:00", "end")
    ).toMatch(/:34:59\.999Z$/);
    expect(
      recentActivityRange(
        60 * 60 * 1000,
        new Date("2026-07-29T10:34:59.987Z")
      )
    ).toEqual({
      from: "2026-07-29T09:34:59.987Z",
      to: "2026-07-29T10:34:59.987Z",
    });
  });
});

describe("live Activity filtering", () => {
  const liveRow = {
    user_id: "user-a",
    play_method: "direct_play" as const,
    media_title: "Test Series I",
    library_id: "library-a",
    peer_node_id: "peer-a",
    started_at: "2026-07-29T10:00:00.000Z",
    duration_ms: 90_000,
    bytes_streamed: 5_000_000,
  };

  it("applies supported facets to live rows", () => {
    expect(
      matchesLiveActivityFilters(liveRow, {
        ...emptyActivityFilters(),
        userIds: ["user-a"],
        playMethods: ["direct_play"],
        titleTerms: ["series i"],
        libraryIds: ["library-a"],
        peerNodeIds: ["peer-a"],
        from: "2026-07-29T09:00:00.000Z",
        to: "2026-07-29T11:00:00.000Z",
        minDurationMs: 60_000,
        maxDurationMs: 120_000,
        minBytesStreamed: 4_000_000,
        maxBytesStreamed: 6_000_000,
        stopReasons: ["in_progress"],
      })
    ).toBe(true);
  });

  it("treats stop-reason filters as in-progress for live rows", () => {
    expect(
      matchesLiveActivityFilters(liveRow, {
        ...emptyActivityFilters(),
        stopReasons: ["completed"],
      })
    ).toBe(false);
    expect(
      matchesLiveActivityFilters(liveRow, {
        ...emptyActivityFilters(),
        stopReasons: ["completed", "in_progress"],
      })
    ).toBe(true);
  });
});
