import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("PlaylistContextMenu", () => {
  const source = readFileSync(
    new URL("./PlaylistContextMenu.tsx", import.meta.url),
    "utf8"
  );

  it("edits playlist names and searchable parents", () => {
    expect(source).toContain("client.updatePlaylist(activePlaylist.id");
    expect(source).toContain("<SearchablePlaylistSelect");
    expect(source).toContain("!excluded.has(playlist.id)");
    expect(source).toContain("playlist.media_type === activePlaylist.media_type");
    expect(source).toContain('openView(playlist, origin, "edit")');
  });

  it("confirms deletion before removing a playlist", () => {
    expect(source).toContain('setView("delete")');
    expect(source).toContain("client.deletePlaylist(activePlaylist.id)");
    expect(source).toContain("deleteDescription");
    expect(source).toContain('openView(playlist, origin, "delete")');
  });
});
