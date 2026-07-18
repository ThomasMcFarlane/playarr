import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("MusicDetail track list", () => {
  it("keeps scaled focused tracks inside the scroll viewport", () => {
    const css = readFileSync(new URL("../styles/global.css", import.meta.url), "utf8");
    const trackRowRule = css.match(
      /\.tv-music-track-row\s*\{(?<declarations>[^}]*)\}/
    )?.groups?.declarations;
    const highlightedTrackRule = css.match(
      /(?<selectors>\.tv-music-track-row:hover,[^{]+)\{(?<declarations>[^}]*)\}/
    )?.groups;

    expect(trackRowRule).toContain("margin-inline: 0.75%");
    expect(highlightedTrackRule?.selectors).toContain(".tv-music-track-row:focus-visible");
    expect(highlightedTrackRule?.selectors).not.toContain(".tv-music-track-row.is-selected");
    expect(highlightedTrackRule?.declarations).toContain("transform: scale(1.012)");
  });

  it("darkens and blurs artwork behind the active album visualiser", () => {
    const css = readFileSync(new URL("../styles/global.css", import.meta.url), "utf8");
    const visualiserRule = css.match(
      /\.tv-music-cover-visualiser-host \.player-music-visualiser\s*\{(?<declarations>[^}]*)\}/
    )?.groups?.declarations;

    expect(visualiserRule).toContain("rgba(8, 5, 7, 0.78)");
    expect(visualiserRule).toContain("backdrop-filter: blur(12px) brightness(0.62)");
    expect(visualiserRule).toContain("mix-blend-mode: normal");
  });

  it("centres persistent inline controls beneath Cover Flow", () => {
    const css = readFileSync(new URL("../styles/global.css", import.meta.url), "utf8");
    const inlineControlsRule = css.match(
      /\.player-shell-inline-music \.player-controls\s*\{(?<declarations>[^}]*)\}/
    )?.groups?.declarations;

    expect(inlineControlsRule).toContain("left: 50%");
    expect(inlineControlsRule).toContain("width: min(76%, 720px)");
    expect(inlineControlsRule).toContain("transform: translateX(-50%)");
    expect(css).toContain(".player-shell-inline-music .player-controls-context-title");
    expect(css).toMatch(
      /\.player-shell-inline-music \.player-time\s*\{[^}]*position: absolute;[^}]*right: 0;/s
    );
  });

  it("uses an unambiguous directional target for inline playback controls", () => {
    const detailSource = readFileSync(new URL("./MusicDetail.tsx", import.meta.url), "utf8");
    const controlsSource = readFileSync(
      new URL("../components/player/PlayerControls.tsx", import.meta.url),
      "utf8"
    );

    expect(detailSource).toContain(
      'data-tv-edge-target-down="#inline-music-playback-control"'
    );
    expect(controlsSource).toContain("id={defaultFocusId}");
  });
});
