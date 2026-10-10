import { afterEach, describe, expect, it, vi } from "vitest";
import { browserDecodesHevc, playbackCapabilitiesForPlatform } from "./playbackCapabilities";

describe("playbackCapabilitiesForPlatform", () => {
  it.each(["tv-webos", "tv-tizen"] as const)(
    "uses a conservative vendor-TV profile for %s",
    (platform) => {
      expect(playbackCapabilitiesForPlatform(platform)).toEqual({
        containers: "mp4,mp3,m4a",
        videoCodecs: "h264",
        audioCodecs: "aac,mp3",
      });
    }
  );

  it("uses the narrower verified subset for Xbox's built-in Edge browser", () => {
    expect(playbackCapabilitiesForPlatform("xbox")).toEqual({
      containers: "mp4,m4v,webm,mp3,m4a",
      videoCodecs: "h264,vp9",
      audioCodecs: "aac,opus",
    });
  });

  it("keeps the broader desktop browser profile", () => {
    expect(playbackCapabilitiesForPlatform("web").videoCodecs).toContain("av1");
    expect(playbackCapabilitiesForPlatform("web").audioCodecs).toContain("flac");
  });

  it("claims HEVC on the desktop browser only when MSE can decode it", () => {
    expect(playbackCapabilitiesForPlatform("web", true).videoCodecs).toBe("h264,h265,vp9,av1");
    expect(playbackCapabilitiesForPlatform("web", false).videoCodecs).toBe("h264,vp9,av1");
    // jsdom has no MediaSource: no claim.
    expect(playbackCapabilitiesForPlatform("web").videoCodecs).not.toContain("h265");
  });

  it("uses the conservative VIDAA browser profile without thinning containers wrongly", () => {
    const vidaa = playbackCapabilitiesForPlatform("tv-vidaa");
    expect(vidaa).toEqual({
      containers: "mp4,webm,mp3,m4a",
      videoCodecs: "h264,vp9",
      audioCodecs: "aac,opus,mp3",
    });
    // Still negotiates common streaming codecs; not an empty claim set.
    const videoCodecs = vidaa.videoCodecs ?? "";
    const audioCodecs = vidaa.audioCodecs ?? "";
    expect(videoCodecs.split(",").filter(Boolean).length).toBeGreaterThanOrEqual(2);
    expect(audioCodecs.split(",").filter(Boolean).length).toBeGreaterThanOrEqual(2);
  });
});

describe("browserDecodesHevc without MediaSource (iPhone Safari)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("asks ManagedMediaSource when MediaSource is undefined", () => {
    vi.stubGlobal("MediaSource", undefined);
    const isTypeSupported = vi.fn().mockReturnValue(true);
    vi.stubGlobal("ManagedMediaSource", { isTypeSupported });
    expect(browserDecodesHevc()).toBe(true);
    expect(isTypeSupported).toHaveBeenCalledWith('video/mp4; codecs="hvc1.2.4.L153.B0"');
  });

  it("falls back to the video element's canPlayType", () => {
    vi.stubGlobal("MediaSource", undefined);
    vi.stubGlobal("ManagedMediaSource", undefined);
    const canPlayType = vi.fn().mockReturnValue("probably");
    vi.stubGlobal("document", { createElement: () => ({ canPlayType }) });
    expect(browserDecodesHevc()).toBe(true);
    canPlayType.mockReturnValue("");
    expect(browserDecodesHevc()).toBe(false);
  });
});
