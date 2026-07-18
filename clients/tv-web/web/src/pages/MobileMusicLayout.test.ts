import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("mobile music layout", () => {
  it("keeps Cover Flow and track gestures compatible with vertical page scrolling", () => {
    const css = readFileSync(new URL("../styles/global.css", import.meta.url), "utf8");

    expect(css).toMatch(
      /\.tv-music-album-cover-flow\s*\{[^}]*overflow: visible;[^}]*touch-action: pan-y;/s
    );
    expect(css).toMatch(
      /\.tv-music-track-list-scroll\s*\{[^}]*height: auto;[^}]*overflow-y: visible;[^}]*touch-action: pan-y;/s
    );
    expect(css).toMatch(/\.tv-music-track-row\s*\{[^}]*touch-action: pan-y;/s);
  });

  it("hosts inline controls directly beneath Cover Flow on mobile", () => {
    const detailSource = readFileSync(new URL("./MusicDetail.tsx", import.meta.url), "utf8");
    const playerSource = readFileSync(new URL("./Player.tsx", import.meta.url), "utf8");
    const css = readFileSync(new URL("../styles/global.css", import.meta.url), "utf8");

    expect(detailSource.indexOf('id="inline-music-player-host"')).toBeGreaterThan(
      detailSource.indexOf("<AlbumCoverFlow")
    );
    expect(detailSource.indexOf('id="inline-music-player-host"')).toBeLessThan(
      detailSource.indexOf("<AlbumTrackList")
    );
    expect(playerSource).toContain("createPortal(playerSurface, inlineMusicHost)");
    expect(css).toMatch(
      /\.tv-inline-music-player-host \.player-page\.is-minimised\.is-inline-music\s*\{[^}]*position: relative;[^}]*height: 142px;/s
    );
  });
});
