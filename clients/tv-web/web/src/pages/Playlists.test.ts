import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Playlists create form", () => {
  const source = readFileSync(new URL("./Playlists.tsx", import.meta.url), "utf8");
  const css = readFileSync(new URL("../styles/global.css", import.meta.url), "utf8");

  it("uses a styled video and audio icon switch instead of a type select", () => {
    expect(source).not.toContain('id="playlist-media-type"');
    expect(source).toContain('role="radiogroup"');
    expect(source).toContain('role="radio"');
    expect(source).toContain("<MoviesIcon />");
    expect(source).toContain("<MusicIcon />");
    expect(css).toContain(".tv-playlist-media-type-switch button.is-active");
  });

  it("switches type horizontally and leaves the switch vertically", () => {
    expect(source).toContain(
      'event.key === "ArrowLeft" || event.key === "ArrowRight"'
    );
    expect(source).toContain("selectPlaylistMediaType(nextType)");
    expect(source).toContain("nameInputRef.current?.focus");
    expect(source).toContain(
      "parentSelectRef.current ?? createSubmitRef.current"
    );
  });

  it("submits the synchronously focused media type", () => {
    expect(source).toContain("playlistMediaTypeRef.current = type");
    expect(source).toContain("media_type: selectedMediaType");
    expect(source).toContain("onFocus={() => selectPlaylistMediaType(type)}");
    expect(source).toContain("created.media_type !== selectedMediaType");
    expect(source).toContain("client.deletePlaylist(created.id)");
  });

  it("shows playlist types and uses searchable parent selection", () => {
    expect(source).toContain("playlistMediaTypeKey");
    expect(source).toContain("<SearchablePlaylistSelect");
    expect(source).toContain("playlistContext.itemProps(track.playlist)");
  });
});
