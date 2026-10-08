import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const detail = read("./WorkDetail.tsx");
const css = read("../styles/global.css");

describe("series page opens on the next item to play", () => {
  it("selects the resume plan's episode and season instead of the first episode", () => {
    expect(detail).toContain("nextUpSelection(seasons, resumePlan, detailWorkId)");
    expect(detail).toContain("nextUp?.seasonNumber ?? firstSeason?.season.season_number");
    expect(detail).toContain("nextUp?.episodeId ??");
  });

  it("waits for the resume plan to settle before the default focus is offered", () => {
    expect(detail).toContain("setResumePlanSettledFor(resumeSeriesId)");
    expect(detail).toContain("const nextUpReady = detailWorkId !== null && resumePlanSettledFor === detailWorkId");
    expect(detail).toContain("data-tv-focus-default={isSelected && defaultFocusReady ? true : undefined}");
    expect(detail).toContain("selectedEpisodeId === nextUpEpisodeId");
  });

  it("focuses and scrolls the next-up tile, but never over a restored or user-chosen focus", () => {
    expect(detail).toContain("if (navigationLayer.hasSnapshot) return;");
    expect(detail).toContain("initialFocusDoneRef.current !== workKey");
    expect(detail).toContain("Do not steal focus the viewer already moved elsewhere");
    expect(detail).toContain("smoothScrollIntoView(initialCard");
    expect(detail).toContain("userSelectionRef.current = { workId: work.id, episodeId };");
  });
});

describe("title detail focus", () => {
  it("keeps one ring token pair for controls", () => {
    expect(css).toContain("--focus-ring-color: color-mix(in srgb, var(--accent, #c4a484) 90%, white);");
    expect(css).toContain("--focus-ring-width: 3px;");
  });

  it("gives media cards (episode, cast, similar title) a lift and shadow, never a ring (owner ruling 2026-10-08)", () => {
    expect(css).not.toMatch(/\.tv-episode-card:focus-visible \.tv-episode-art \{\s*outline/);
    expect(css).toMatch(/\.tv-episode-card:focus-visible,[^{]*\{[^}]*transform: translateY\(-7px\)/s);
    expect(css).toMatch(/\.tv-episode-card:focus-visible \.tv-episode-art,[^{]*\{[^}]*box-shadow:\s*0 24px 48px rgba\(56, 38, 33, 0\.3\)[^}]*transform: scale\(1\.025\)/s);
    // The remote marker lifts too; no ring in its shadow stack.
    expect(css).not.toContain("0 0 0 var(--focus-ring-width) var(--focus-ring-color),");
    expect(css).toMatch(/\.tv-title-card\[data-remote-active\] \{\s*transform: translateY\(-7px\) !important;/);
    expect(css).toMatch(/\.tv-home-card\[data-remote-active\] \.tv-home-card-art \{\s*transform: scale\(1\.025\) !important;\s*box-shadow: 0 26px 52px/);
  });

  it("paints the ring on every other control on the detail page, beating the per-control outline resets", () => {
    expect(css).toMatch(
      /\.tv-detail :is\(a, button, input, select, textarea, \[tabindex\]\):focus-visible:not\(\.tv-episode-card\) \{\s*outline: var\(--focus-ring-width\) solid var\(--focus-ring-color\);/
    );
    for (const selector of [".tv-detail-play:hover,\n.tv-detail-play:focus-visible", ".tv-track-action:hover,\n.tv-track-action:focus-visible"]) {
      expect(css).toContain(selector);
    }
  });

  it("keeps touch autofocus quiet on phone layouts", () => {
    expect(css).toContain("@media (max-width: 760px) and (hover: none)");
  });
});
