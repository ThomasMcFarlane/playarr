import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("MediaContextMenu audio playlist targets", () => {
  const menuSource = readFileSync(
    new URL("./MediaContextMenu.tsx", import.meta.url),
    "utf8"
  );
  const musicSource = readFileSync(
    new URL("../pages/MusicDetail.tsx", import.meta.url),
    "utf8"
  );

  it("resolves held artists to all playable tracks", () => {
    expect(menuSource).toContain('item.work?.kind === "artist"');
    expect(menuSource).toContain("playableAudioTrackIds(await getDetail(target.workId))");
    expect(menuSource).toContain('mediaType: "audio"');
  });

  it("adds only missing tracks and rolls back a partially added collection", () => {
    expect(menuSource).toContain("const missingTrackIds = trackIds.filter");
    expect(menuSource).toContain("for (const trackId of missingTrackIds)");
    expect(menuSource).toContain("addedItemIds.map((itemId)");
    expect(menuSource).toContain("removePlaylistItem(playlist.id, itemId)");
  });

  it("opens the shared hold menu for Cover Flow albums", () => {
    expect(musicSource).toContain("playlistTrackIds: playableTracks(album).map");
    expect(musicSource).toContain("contextProps.onKeyDown(event)");
    expect(musicSource).toContain("{mediaContext.contextMenu}");
  });
});
