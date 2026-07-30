import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const librarySource = readFileSync(new URL("./Library.tsx", import.meta.url), "utf8");
const foldersSource = readFileSync(
  new URL("./LibraryFolders.tsx", import.meta.url),
  "utf8"
);
const playerSource = readFileSync(new URL("./Player.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../styles/global.css", import.meta.url), "utf8");

describe("Library folders view", () => {
  it("is a persisted library filter mode backed by the folder API", () => {
    expect(librarySource).toContain(
      'type LibraryView = "list" | "screen" | "cover" | "cover-flow" | "folders"'
    );
    expect(librarySource).toContain("<LibraryFolders");
    expect(foldersSource).toContain(".listFolderRoots(kind)");
    expect(foldersSource).toContain(".browseFolder(selectedRoot.id");
  });

  it("uses authenticated thumbnails and restores the folder route after playback", () => {
    expect(foldersSource).toContain("<MediaThumbnailArtwork");
    expect(foldersSource).toContain(
      "entry.media_file_id && entry.thumbnail_url"
    );
    expect(foldersSource).toContain("to={`/player/${encodeURIComponent(entry.media_file_id)}`}");
    expect(foldersSource).toContain("backTo: folderBackTo");
    expect(foldersSource).toContain("navigationOrigin");
    expect(foldersSource).toContain(
      "serverUrl: getJoinedFolderRootServerUrl(selectedRoot.id)"
    );
    expect(playerSource).toContain(
      "\\?folderRoot=[^&#]+(?:&folderPath=[^#]*)?"
    );
  });

  it("marks each overflowing root, breadcrumb and entry viewport for navigation", () => {
    expect(foldersSource.match(/data-tv-scroll-container/g)).toHaveLength(3);
    expect(foldersSource).toContain('data-tv-scroll-axis="horizontal"');
    expect(foldersSource).toContain('data-tv-scroll-axis="vertical"');
    expect(foldersSource).toContain("data-navigation-scroll-key");
    expect(css).toMatch(
      /\.tv-folder-entry-scroll\s*\{[^}]*overflow-y:\s*auto;[^}]*-webkit-overflow-scrolling:\s*touch;/s
    );
  });

  it("renders the server breadcrumb chain without duplicating its root", () => {
    expect(foldersSource).toContain(
      "browse.breadcrumbs.map((breadcrumb, index)"
    );
    expect(foldersSource).not.toContain(
      "className={browse.path ? \"\" : \"is-current\"}"
    );
  });
});
