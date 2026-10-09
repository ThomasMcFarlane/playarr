import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import type { AvailabilityLag, CalendarSourceStatus } from "@playarr-tv/api-client";
import { describe, expect, it } from "vitest";
import { availabilityLagLines } from "../components/AvailabilityLag";
import { translations } from "../lib/i18n/translations";
import { formatRangeLabel } from "./Calendar";

const en = translations.en;
const t = (key: keyof typeof en, params?: Record<string, string | number>) =>
  en[key].replace(/\{\{(\w+)\}\}/g, (m, k: string) => (params && k in params ? String(params[k]) : m));

const sources: CalendarSourceStatus[] = [
  { source_instance_id: "1", name: "Main Sonarr", kind: "sonarr", status: "ok", entry_count: 4 },
  { source_instance_id: "2", name: "4K Radarr", kind: "radarr", status: "unreachable", error: "timed out", entry_count: 0 },
  { source_instance_id: "3", name: "Music", kind: "lidarr", status: "rejected", entry_count: 0 },
];

describe("formatRangeLabel", () => {
  it("renders the month and the week range with Intl", () => {
    expect(formatRangeLabel("month", "2026-10-01", 1, "en-GB")).toBe("October 2026");
    expect(formatRangeLabel("week", "2026-10-07", 1, "en-GB")).toBe("5 Oct – 11 Oct 2026");
  });
});

describe("availabilityLagLines", () => {
  const base: AvailabilityLag = {
    average_seconds: 3 * 3600,
    sample_count: 12,
    backfill_count: 2,
    unknown_count: 1,
    backfill_threshold_days: 30,
    average_grab_seconds: null,
    samples: [],
  };

  it("shows the human duration and mentions exclusions in a secondary line", () => {
    const lines = availabilityLagLines(base, t, "en-GB");
    expect(lines.primary).toBe("Usually available about 3 hours after release");
    expect(lines.secondary).toContain("Based on 12 episodes");
    expect(lines.secondary).toContain("2 excluded as backfilled more than 30 days after release");
    expect(lines.secondary).toContain("1 excluded for missing dates");
  });

  it("is honest when there is no data", () => {
    const lines = availabilityLagLines({ ...base, average_seconds: null, sample_count: 0, backfill_count: 0, unknown_count: 0 }, t, "en-GB");
    expect(lines.primary).toBe("No availability data yet");
    expect(lines.secondary).toBeNull();
  });
});

describe("calendar scroll and focus contract", () => {
  const page = readFileSync(new URL("./Calendar.tsx", import.meta.url), "utf8");
  const css = readFileSync(new URL("./Calendar.css", import.meta.url), "utf8");

  it("owns native scroll containers with the shared data attributes", () => {
    expect(page).toContain("data-tv-scroll-container");
    expect(page).toContain("<ListPanel");
    expect(readFileSync(new URL("../components/tv/ListPanel.tsx", import.meta.url), "utf8")).toContain("data-tv-scroll-axis={axis}");
    expect(page).toContain('data-navigation-scroll-key="calendar:body"');
    expect(css).toMatch(/\.calendar-scroll\s*\{[^}]*overflow-y: auto/);
  });

  it("enables touch scrolling on every overflow:auto viewport", () => {
    const blocks = css.split("}").filter((block) => /overflow(-x|-y)?:\s*auto;/.test(block));
    expect(blocks.length).toBeGreaterThan(0);
    for (const block of blocks) expect(block).toContain("-webkit-overflow-scrolling");
  });

  it("closes the entry sheet on Back and keeps touch targets at 44px", () => {
    expect(page).toContain("isBackKey(event)");
    expect(page).toContain("isBackKey");
    expect(css).toMatch(/\.calendar-filter-chip[^{]*\{[^}]*min-height: 44px/s);
  });
});
