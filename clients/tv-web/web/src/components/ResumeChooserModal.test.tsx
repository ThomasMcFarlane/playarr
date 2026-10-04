import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ResumeOption, ResumePlan } from "@playarr-tv/api-client";
import { LanguageProvider } from "../lib/i18n/LanguageProvider";
import { ResumeChooserModal } from "./ResumeChooserModal";

function option(overrides: Partial<ResumeOption>): ResumeOption {
  return {
    kind: "next_in_series",
    episode_id: "e",
    media_file_id: "m",
    season_number: 1,
    episode_number: 1,
    label: "S01E01",
    title: "Pilot",
    position_ms: 0,
    duration_ms: 1_800_000,
    progress_percent: 0,
    ...overrides,
  };
}

function render(options: ResumeOption[]): string {
  const plan: ResumePlan = {
    series_work_id: "s",
    action: "resume",
    reason: "choice_required",
    needs_choice: true,
    ask_reasons: ["multiple_unfinished"],
    target: options[0],
    options,
  };
  return renderToStaticMarkup(
    <LanguageProvider>
      <ResumeChooserModal
        plan={plan}
        seriesTitle="Show"
        onCancel={() => undefined}
        onSelect={() => undefined}
      />
    </LanguageProvider>
  );
}

describe("ResumeChooserModal", () => {
  const unfinished = option({
    kind: "unfinished",
    episode_id: "e4",
    label: "S01E04",
    title: "Four",
    progress_percent: 40,
    last_watched_at: "2026-10-01T10:00:00Z",
  });
  const missed = option({ kind: "missed_episode", episode_id: "e1", label: "S01E01" });
  const next = option({ kind: "next_in_series", episode_id: "e5", label: "S02E03", title: null });

  it("is a modal dialog listing every option as a button, in order", () => {
    const html = render([unfinished, missed, next]);
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    const kinds = [...html.matchAll(/data-option-kind="([a-z_]+)"/g)].map((m) => m[1]);
    expect(kinds).toEqual(["unfinished", "missed_episode", "next_in_series"]);
    expect(html).toContain("S01E04");
    expect(html).toContain("Four");
    expect(html).toContain("S02E03");
    expect(html.match(/<button/g)?.length).toBe(4); // three options plus Cancel
  });

  it("shows the date last watched and a progress bar only for unfinished episodes", () => {
    const html = render([unfinished, missed, next]);
    expect(html.match(/role="progressbar"/g)?.length).toBe(1);
    expect(html).toContain('aria-valuenow="40"');
    expect(html).toContain("width:40%");
    expect(html).toContain("2026");
    expect(html.match(/Last watched/g)?.length).toBe(1);
  });
});
