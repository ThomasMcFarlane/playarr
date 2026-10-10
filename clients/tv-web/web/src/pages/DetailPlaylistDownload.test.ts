import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("title detail Add to Playlist and season Download", () => {
  const detail = read("./WorkDetail.tsx");
  const menu = read("../components/MediaContextMenu.tsx");
  const stage = read("../components/tv/TvStage.tsx");

  it("shows an Add to Playlist pill beside Add to watchlist that opens the playlist picker", () => {
    expect(detail).toContain('data-navigation-focus-key={`detail:${work.id}:add-to-playlist`}');
    expect(detail.replace(/\s+/g, " ")).toContain('detailMediaContext.openAction( "playlists"');
    expect(detail).toContain('t("components.mediaContextMenu.addToPlaylist")');
    expect(detail.indexOf("focusKey={`detail:${work.id}:watchlist`}")).toBeLessThan(
      detail.indexOf("detail:${work.id}:add-to-playlist")
    );
  });

  it("has no Download button on the season tracks; an episode offers a whole-season scope instead", () => {
    expect(detail).not.toContain("downloads.canDownload === true && seasonLeaves.length > 0");
    expect(detail).toContain("downloadScopes: { season: seasonLeaves }");
    expect(stage).toContain("headingAction");
  });

  it("opens the shared drawer directly on the requested action", () => {
    expect(menu).toContain('action: "playlists" | "download"');
    expect(menu).toContain('if (pendingAction === "playlists") void openPlaylistPicker();');
    expect(menu).toContain("else void download();");
    expect(menu).toContain("openAction,");
  });
});
