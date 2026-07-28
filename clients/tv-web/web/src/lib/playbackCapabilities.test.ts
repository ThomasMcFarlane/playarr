import { describe, expect, it } from "vitest";
import { playbackCapabilitiesForPlatform } from "./playbackCapabilities";

describe("playbackCapabilitiesForPlatform", () => {
  it.each(["tv-webos", "tv-tizen"] as const)(
    "uses a conservative vendor-TV profile for %s",
    (platform) => {
      expect(playbackCapabilitiesForPlatform(platform)).toEqual({
        containers: "mp4,mp3,m4a",
        videoCodecs: "h264,h265",
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
});
