import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Home layout", () => {
  it("shares media-copy layout and typography across home, directories, and details", () => {
    const css = readFileSync(new URL("../styles/global.css", import.meta.url), "utf8");
    const sharedCopyRule = css.match(
      /\.tv-home-feature,\s*\.tv-library-preview,\s*\.tv-detail-copy\s*\{(?<declarations>[^}]*)\}/
    )?.groups?.declarations;
    const sharedTitleRule = css.match(
      /\.tv-home-feature h2,\s*\.tv-library-preview h2,\s*\.tv-detail > \.tv-detail-copy h1\s*\{(?<declarations>[^}]*)\}/
    )?.groups?.declarations;
    const sharedSynopsisRule = css.match(
      /\.tv-home-feature > p:not\(\.tv-provider\),\s*\.tv-preview-overview,\s*\.tv-detail-synopsis\s*\{(?<declarations>[^}]*)\}/
    )?.groups?.declarations;
    const mobileDetailCopyRule = css.match(
      /\.tv-detail-copy\s*\{(?<declarations>[^}]*--mobile-top-inset[^}]*)\}/
    )?.groups?.declarations;
    const mobileDetailTitleRule = css.match(
      /\.tv-detail > \.tv-detail-copy h1\s*\{(?<declarations>[^}]*10vw[^}]*)\}/
    )?.groups?.declarations;
    const mobileDetailSynopsisRule = css.match(
      /\.tv-detail-synopsis\s*\{(?<declarations>[^}]*0\.72rem[^}]*)\}/
    )?.groups?.declarations;
    const previewExpandFrames = css.slice(
      css.indexOf("@keyframes tv-preview-expand"),
      css.indexOf("@keyframes tv-loader-spin")
    );

    expect(sharedCopyRule).toContain("top: 24%");
    expect(sharedCopyRule).toContain("left: clamp(102px, 8vw, 160px)");
    expect(sharedCopyRule).toContain("width: min(24vw, 455px)");
    expect(sharedTitleRule).toContain("font-size: clamp(2.2rem, 3.6vw, 5rem)");
    expect(sharedTitleRule).toContain("line-height: 0.9");
    expect(sharedSynopsisRule).toContain("max-width: 42ch");
    expect(sharedSynopsisRule).toContain("margin-top: clamp(16px, 2vh, 28px)");
    expect(sharedSynopsisRule).toContain("-webkit-line-clamp: 5");
    expect(mobileDetailCopyRule).toContain(
      "top: calc(var(--mobile-top-inset) + 58px)"
    );
    expect(mobileDetailCopyRule).toContain("width: calc(100% - 32px)");
    expect(mobileDetailTitleRule).toContain("font-size: clamp(2rem, 10vw, 3.5rem)");
    expect(mobileDetailSynopsisRule).toContain("margin-top: 10px");
    expect(mobileDetailSynopsisRule).toContain("-webkit-line-clamp: 3");
    expect(css).toMatch(
      /\.tv-home:not\(\.tv-playlists\) > \.tv-home-feature,\s*\.tv-playlists\.is-playlist-directory > \.tv-playlist-feature\s*\{[^}]*display:\s*none/s
    );
    expect(css).toMatch(
      /\.tv-detail > \.tv-key-art,\s*\.tv-playlists\.is-playlist-detail > \.tv-key-art\s*\{[^}]*position:\s*sticky[^}]*margin-bottom:\s*-24vh/s
    );
    expect(css).toMatch(
      /\.tv-detail-copy\s*\{[^}]*position:\s*relative[^}]*padding-top:\s*calc\(var\(--mobile-top-inset\) \+ 64px\)/s
    );
    expect(css).toMatch(
      /\.tv-playlists\.is-playlist-detail > \.tv-playlist-feature\s*\{[^}]*position:\s*relative[^}]*padding-top:\s*calc\(var\(--mobile-top-inset\) \+ 64px\)/s
    );
    expect(css).not.toContain(".tv-music-detail .tv-detail-copy");
    expect(previewExpandFrames).not.toContain("width:");
  });
});
