import { describe, expect, it, vi } from "vitest";
import {
  buildSubtitleTrackFields,
  clearActiveSubtitleTrack,
  loadAndActivateSubtitleTrack,
  selectPreferredSubtitleTrack,
  type SideloadableTextTracksManager,
} from "./subtitles";

describe("buildSubtitleTrackFields", () => {
  it("maps label/language onto the CAF track field shape", () => {
    expect(buildSubtitleTrackFields({ label: "English", language: "en" }, "blob:abc")).toEqual({
      trackContentId: "blob:abc",
      trackContentType: "text/vtt",
      subtype: "SUBTITLES",
      name: "English",
      language: "en",
    });
  });

  it("omits language entirely when the option has none", () => {
    const fields = buildSubtitleTrackFields({ label: "Unknown", language: null }, "blob:xyz");
    expect(fields.language).toBeUndefined();
    expect("language" in fields).toBe(false);
  });
});

describe("selectPreferredSubtitleTrack", () => {
  const options = [
    { id: "sub-en", language: "en" },
    { id: "sub-fr", language: "fr" },
    { id: "sub-forced", language: "en" },
  ];

  it("prefers an exact track id match", () => {
    expect(selectPreferredSubtitleTrack(options, "sub-fr", "en")).toBe(options[1]);
  });

  it("falls back to a language match when no id matches", () => {
    expect(selectPreferredSubtitleTrack(options, "sub-missing", "fr")).toBe(options[1]);
  });

  it("returns undefined when neither id nor language match anything", () => {
    expect(selectPreferredSubtitleTrack(options, "sub-missing", "de")).toBeUndefined();
  });

  it("returns undefined when no preference is given at all", () => {
    expect(selectPreferredSubtitleTrack(options, null, null)).toBeUndefined();
    expect(selectPreferredSubtitleTrack(options, undefined, undefined)).toBeUndefined();
  });
});

function makeFakeTextTracksManager(): SideloadableTextTracksManager & {
  tracks: Array<{ trackId: number } & Record<string, unknown>>;
  activeIds: number[] | null;
} {
  let nextTrackId = 1;
  return {
    tracks: [],
    activeIds: null,
    createTrack() {
      return { trackId: nextTrackId++ };
    },
    addTracks(tracks) {
      this.tracks.push(...(tracks as Array<{ trackId: number } & Record<string, unknown>>));
    },
    setActiveByIds(ids) {
      this.activeIds = ids;
    },
  };
}

describe("loadAndActivateSubtitleTrack", () => {
  it("fetches the VTT, sideloads a track with the mapped fields, and activates it", async () => {
    const manager = makeFakeTextTracksManager();
    const getMediaSubtitle = vi.fn(async () => new Blob(["WEBVTT"], { type: "text/vtt" }));

    await loadAndActivateSubtitleTrack(
      { getMediaSubtitle, textTracksManager: manager },
      "file-1",
      { label: "English", language: "en", stream_index: 2 },
      5_000
    );

    expect(getMediaSubtitle).toHaveBeenCalledWith("file-1", 2, 5_000);
    expect(manager.tracks).toHaveLength(1);
    expect(manager.tracks[0]).toMatchObject({
      trackContentType: "text/vtt",
      subtype: "SUBTITLES",
      name: "English",
      language: "en",
    });
    expect(manager.activeIds).toEqual([manager.tracks[0]?.trackId]);
  });

  it("rounds and floors the source offset before requesting the subtitle", async () => {
    const manager = makeFakeTextTracksManager();
    const getMediaSubtitle = vi.fn(async () => new Blob(["WEBVTT"]));

    await loadAndActivateSubtitleTrack(
      { getMediaSubtitle, textTracksManager: manager },
      "file-1",
      { label: "English", language: "en", stream_index: 0 },
      -12.9
    );

    expect(getMediaSubtitle).toHaveBeenCalledWith("file-1", 0, 0);
  });

  it("logs and resolves without throwing when the fetch fails", async () => {
    const manager = makeFakeTextTracksManager();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const getMediaSubtitle = vi.fn(async () => {
      throw new Error("404 not found");
    });

    await expect(
      loadAndActivateSubtitleTrack(
        { getMediaSubtitle, textTracksManager: manager },
        "file-1",
        { label: "English", language: "en", stream_index: 2 },
        0
      )
    ).resolves.toBeUndefined();

    expect(manager.tracks).toHaveLength(0);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("logs and resolves without throwing when sideloading itself throws", async () => {
    const manager = makeFakeTextTracksManager();
    manager.addTracks = () => {
      throw new Error("trackId not unique");
    };
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const getMediaSubtitle = vi.fn(async () => new Blob(["WEBVTT"]));

    await expect(
      loadAndActivateSubtitleTrack(
        { getMediaSubtitle, textTracksManager: manager },
        "file-1",
        { label: "English", language: "en", stream_index: 2 },
        0
      )
    ).resolves.toBeUndefined();

    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});

describe("clearActiveSubtitleTrack", () => {
  it("sets active ids to null", () => {
    const manager = makeFakeTextTracksManager();
    manager.activeIds = [7];
    clearActiveSubtitleTrack(manager);
    expect(manager.activeIds).toBeNull();
  });
});
