import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import type { AvailabilityLag, CalendarEntry, CalendarSourceStatus } from "@playarr-tv/api-client";
import { describe, expect, it } from "vitest";
import { availabilityLagLines } from "../components/AvailabilityLag";
import { translations } from "../lib/i18n/translations";
import { DaySections, MonthGrid, formatRangeLabel } from "./Calendar";

const en = translations.en;
const t = (key: keyof typeof en, params?: Record<string, string | number>) =>
  en[key].replace(/\{\{(\w+)\}\}/g, (m, k: string) => (params && k in params ? String(params[k]) : m));

const sources: CalendarSourceStatus[] = [
  { source_instance_id: "1", name: "Main source", kind: "sonarr", status: "ok", entry_count: 4 },
  { source_instance_id: "2", name: "4K source", kind: "radarr", status: "unreachable", error: "timed out", entry_count: 0 },
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
    const lines = availabilityLagLines(base, t, "en-GB")!;
    expect(lines.primary).toBe("Usually available about 3 hours after release");
    expect(lines.secondary).toContain("Based on 12 episodes");
    expect(lines.secondary).toContain("2 excluded as backfilled more than 30 days after release");
    expect(lines.secondary).toContain("1 excluded for missing dates");
  });

  it("shows nothing at all when there is no data, never a no-availability message", () => {
    const empty = { ...base, average_seconds: null, sample_count: 0, backfill_count: 0, unknown_count: 0 };
    expect(availabilityLagLines(empty, t, "en-GB")).toBeNull();
    expect(availabilityLagLines({ ...empty, backfill_count: 3, unknown_count: 2 }, t, "en-GB")).toBeNull();
  });
});

const entryFor = (extra: Partial<CalendarEntry> = {}): CalendarEntry => ({
  id: "e1",
  media_kind: "movie",
  release_type: "digital",
  title: "Sample Movie 1",
  date: "2026-10-07",
  monitored: true,
  has_file: false,
  sources: [],
  ...extra,
});

const noop = () => undefined;

function renderDays(showEmpty: boolean): string {
  return renderToStaticMarkup(
    <DaySections
      days={[{ day: "2026-10-07", entries: [entryFor()] }]}
      t={t}
      locale="en-GB"
      today="2026-10-07"
      showEmpty={showEmpty}
      selectedKey={null}
      onSelect={noop}
    />
  );
}

/** The value of the last declaration of `prop` in rules whose selector list is exactly `selector`. */
function effectiveDeclaration(css: string, selector: string, prop: string): string | null {
  let found: string | null = null;
  for (const [, selectors, body] of css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!selectors!.split(",").some((part) => part.trim() === selector)) continue;
    const match = new RegExp(`(?:^|[;\\s])${prop}:\\s*([^;]+);`).exec(body!);
    if (match) found = match[1]!.trim();
  }
  return found;
}

describe("calendar scroll contract", () => {
  const css = readFileSync(new URL("./Calendar.css", import.meta.url), "utf8");

  it("gives each week day column the shared scroll attributes and a key of its own", () => {
    const week = renderDays(true);
    expect(week).toContain("data-tv-scroll-container");
    expect(week).toContain('data-tv-scroll-axis="vertical"');
    expect(week).toContain('data-navigation-scroll-key="calendar:day:2026-10-07"');
  });

  it("leaves the agenda sections as plain sections: the list around them scrolls", () => {
    const agenda = renderDays(false);
    expect(agenda).not.toContain("data-tv-scroll-container");
    expect(agenda).not.toContain("calendar-edge-scroller");
  });

  it("keeps the body frame from scrolling while the inner viewports do", () => {
    expect(effectiveDeclaration(css, ".calendar-scroll", "overflow")).toBe("hidden");
    expect(effectiveDeclaration(css, ".calendar-month-scroll", "overflow-x")).toBe("auto");
        expect(effectiveDeclaration(css, ".calendar-week-scroll .calendar-day", "overflow-y")).toBe("auto");
  });

  it("enables touch scrolling on every overflow:auto viewport", () => {
    const blocks = css.split("}").filter((block) => /overflow(-x|-y)?:\s*auto;/.test(block));
    expect(blocks.length).toBeGreaterThan(0);
    for (const block of blocks) expect(block).toContain("-webkit-overflow-scrolling");
  });
});

describe("month grid markup", () => {
  const markup = renderToStaticMarkup(
    <MonthGrid
      anchor="2026-10-01"
      firstDay={1}
      groups={[{ day: "2026-10-07", entries: [entryFor()] }]}
      today="2026-10-07"
      t={t}
      locale="en-GB"
      selectedKey={null}
      onSelect={noop}
      onMore={noop}
    />
  );

  it("does not claim a grid whose cells nothing can focus", () => {
    for (const role of ["grid", "row", "gridcell", "columnheader"]) expect(markup).not.toContain(`role="${role}"`);
  });

  it("gives each chip its date in its accessible name, starting with the visible text", () => {
    expect(markup).toContain('aria-label="Sample Movie 1, ');
    expect(markup).toMatch(/aria-label="Sample Movie 1, [^"]*7[^"]*"/);
  });
});

describe("day sections", () => {
  it("name each day once, through its heading", () => {
    const agenda = renderDays(false);
    expect(agenda).toContain("<h3>");
    expect(agenda).not.toMatch(/<section[^>]*aria-label=/);
  });
});

describe("calendar source labels", () => {
  const page = readFileSync(new URL("./Calendar.tsx", import.meta.url), "utf8");

  it("uses the neutral display_label, never the admin-chosen name", () => {
    expect(page).toContain("source.display_label ?? source.name");
    expect(page).not.toMatch(/\{source\.source_name\}/);
  });
});
