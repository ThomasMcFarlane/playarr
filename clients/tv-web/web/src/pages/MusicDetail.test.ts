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

  it("covers active artwork with a transparent visualiser gradient", () => {
    const css = readFileSync(new URL("../styles/global.css", import.meta.url), "utf8");
    const detailSource = readFileSync(new URL("./MusicDetail.tsx", import.meta.url), "utf8");
    const surfaceSource = readFileSync(
      new URL("../components/player/PlayerSurface.tsx", import.meta.url),
      "utf8"
    );
    const visualiserRule = css.match(
      /\.tv-music-cover-visualiser-host \.player-music-visualiser\s*\{(?<declarations>[^}]*)\}/
    )?.groups?.declarations;

    expect(visualiserRule).toContain("inset: 0");
    expect(visualiserRule).toContain("height: 100%");
    expect(visualiserRule).toContain("padding: 46% 10% 9%");
    expect(visualiserRule).toContain("transparent 0%");
    expect(visualiserRule).toContain("rgba(8, 5, 7, 0.68) 100%");
    expect(visualiserRule).toContain("box-shadow: none");
    expect(visualiserRule).toContain("backdrop-filter: blur(3px) brightness(0.78)");
    expect(visualiserRule).toContain("mix-blend-mode: normal");
    expect(detailSource).toContain("<MusicVisualiserBars />");
    expect(surfaceSource).not.toContain("createPortal(visualiser");
  });

  it("uses the same inset full-art gradient in the mini-player", () => {
    const css = readFileSync(new URL("../styles/global.css", import.meta.url), "utf8");
    const miniVisualiserRule = css.match(
      /\.player-shell-minimised\.player-shell-music \.player-music-visualiser\s*\{(?<declarations>[^}]*)\}/
    )?.groups?.declarations;

    expect(miniVisualiserRule).toContain("inset: 0");
    expect(miniVisualiserRule).toContain("height: 100%");
    expect(miniVisualiserRule).toContain("padding: 45% 10% 9%");
    expect(miniVisualiserRule).toContain("transparent 0%");
    expect(miniVisualiserRule).toContain("rgba(8, 5, 7, 0.68) 100%");
    expect(miniVisualiserRule).toContain("mix-blend-mode: normal");
  });

  it("runs the track viewport to the bottom of the page", () => {
    const css = readFileSync(new URL("../styles/global.css", import.meta.url), "utf8");
    const musicBrowserRule = css.match(
      /\.tv-music-browser\.is-content\s*\{(?<declarations>[^}]*)\}/
    )?.groups?.declarations;
    const trackWindowRule = css.match(
      /\.tv-music-track-list-window\s*\{(?<declarations>[^}]*)\}/
    )?.groups?.declarations;
    const trackListRule = css.match(
      /\.tv-music-track-list\s*\{(?<declarations>[^}]*)\}/
    )?.groups?.declarations;
    const trackScrollRule = css.match(
      /\.tv-music-track-list-scroll\s*\{(?<declarations>[^}]*)\}/
    )?.groups?.declarations;

    expect(musicBrowserRule).toContain("padding: clamp(104px, 13vh, 142px) 0 0");
    expect(trackListRule).toContain("padding: clamp(58px, 6vh, 76px) 0 0");
    expect(trackWindowRule).toContain("min-height: 0");
    expect(trackWindowRule).toContain("overflow: hidden");
    expect(trackScrollRule).toContain("clamp(34px, 5vh, 58px)");
    expect(trackScrollRule).toContain("overflow-y: auto");
    expect(trackScrollRule).toContain("scroll-behavior: auto");
  });

  it("moves album metadata left and uses contextual detail headings", () => {
    const musicSource = readFileSync(new URL("./MusicDetail.tsx", import.meta.url), "utf8");
    const workSource = readFileSync(new URL("./WorkDetail.tsx", import.meta.url), "utf8");

    expect(musicSource).not.toContain("tv-music-track-list-heading");
    expect(musicSource).toContain("<h1>{selectedAlbum?.album.title ?? work.title}</h1>");
    expect(musicSource).toContain("<span>{work.title}</span>");
    expect(musicSource).toContain('sectionTitle={t("shell.nav.music")}');
    expect(musicSource).toContain("itemTitle={work.title}");
    expect(workSource).toContain('t("shell.nav.movies")');
    expect(workSource).toContain('t("shell.nav.series")');
    expect(workSource).toContain("sectionTitle={detailCollectionLabel}");
    expect(workSource).toContain("itemTitle={work.title}");
  });

  it("centres persistent inline controls beneath Cover Flow", () => {
    const css = readFileSync(new URL("../styles/global.css", import.meta.url), "utf8");
    const albumFlowRule = css.match(
      /\.tv-music-album-flow\s*\{(?<declarations>[^}]*)\}/
    )?.groups?.declarations;
    const inlineControlsRule = css.match(
      /\.player-shell-inline-music \.player-controls\s*\{(?<declarations>[^}]*)\}/
    )?.groups?.declarations;

    expect(albumFlowRule).toContain("padding-left: 0");
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
    const surfaceSource = readFileSync(
      new URL("../components/player/PlayerSurface.tsx", import.meta.url),
      "utf8"
    );

    expect(detailSource).toContain(
      'data-tv-edge-target-down="#inline-music-scrubber-control"'
    );
    expect(detailSource).toContain(
      'index === 0 ? "#inline-music-playback-control" : undefined'
    );
    expect(detailSource).not.toContain(
      'data-tv-edge-target-up="#inline-music-playback-control"'
    );
    expect(detailSource).toMatch(
      /event\.key === "ArrowUp"[\s\S]*?event\.preventDefault\(\);[\s\S]*?event\.stopPropagation\(\);/
    );
    expect(detailSource).toMatch(
      /event\.key === "ArrowDown"[\s\S]*?getElementById\("inline-music-scrubber-control"\)[\s\S]*?\.tv-music-track-row/
    );
    expect(detailSource).toMatch(
      /event\.key !== "ArrowUp" \|\| index !== 0[\s\S]*?getElementById\("inline-music-playback-control"\)[\s\S]*?\.tv-music-album-card\.is-selected/
    );
    expect(controlsSource).toContain("id={defaultFocusId}");
    expect(controlsSource).toContain("id={seekFocusId}");
    expect(controlsSource).toContain("if (onNavigateAbove) onNavigateAbove()");
    expect(controlsSource).toContain("trackRef.current?.focus()");
    expect(controlsSource).toContain("playButtonRef.current?.focus()");
    expect(controlsSource).toContain("onNavigateBelow?.()");
    expect(controlsSource).toContain("control.getClientRects().length > 0");
    expect(surfaceSource).not.toContain('target.closest(".player-controls")');
    expect(surfaceSource).toContain(
      'document.querySelector<HTMLElement>(".tv-music-track-row")'
    );
  });

  it("keeps the scrubber bar height fixed when its thumb appears", () => {
    const css = readFileSync(new URL("../styles/global.css", import.meta.url), "utf8");
    const seekFocusRule = css.match(
      /\.player-seek-track:hover,[^{]+\.player-seek-track\.is-scrubbing\s*\{(?<declarations>[^}]*)\}/
    )?.groups?.declarations;

    expect(seekFocusRule).not.toContain("height:");
    expect(css).toMatch(
      /\.player-seek-track:focus-visible \.player-seek-thumb,[^{]+\{[^}]*opacity: 1;/s
    );
  });

  it("debounces seeks without unmounting controls during the reload", () => {
    const controlsSource = readFileSync(
      new URL("../components/player/PlayerControls.tsx", import.meta.url),
      "utf8"
    );
    const playerSource = readFileSync(new URL("./Player.tsx", import.meta.url), "utf8");

    expect(controlsSource).toContain("const SEEK_COMMIT_DEBOUNCE_MS = 300");
    expect(controlsSource).toContain("window.clearTimeout(seekCommitTimerRef.current)");
    expect(controlsSource).toContain("pendingSeek !== null && seekWasPlayingRef.current");
    expect(playerSource).toContain(
      'negotiation.kind === "loading" && !keepInlinePlayerMounted'
    );
  });

  it("keeps the inline mini-player inside the app layout scope", () => {
    const surfaceSource = readFileSync(
      new URL("../components/player/PlayerSurface.tsx", import.meta.url),
      "utf8"
    );
    const miniPlayerSource = surfaceSource.slice(
      surfaceSource.indexOf("export function InlineMusicMiniPlayer"),
      surfaceSource.indexOf("export function PlayerSurface")
    );

    expect(miniPlayerSource).toContain("player-inline-music-mini");
    expect(miniPlayerSource).not.toContain("createPortal(");
  });

  it("opens the shared hold menu for tracks and targets audio playlists", () => {
    const detailSource = readFileSync(new URL("./MusicDetail.tsx", import.meta.url), "utf8");
    const contextMenuSource = readFileSync(
      new URL("../components/MediaContextMenu.tsx", import.meta.url),
      "utf8"
    );

    expect(detailSource).toContain("playlistTrackId: track.track.id");
    expect(contextMenuSource).toContain('mediaType: "audio"');
    expect(contextMenuSource).toContain("playlist.media_type === target.mediaType");
    expect(contextMenuSource).toContain("track_id: target.trackId");
    expect(contextMenuSource).toContain("const LONG_PRESS_MS = 650");
  });
});
