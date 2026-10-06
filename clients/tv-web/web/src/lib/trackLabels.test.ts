import { describe, expect, it } from "vitest";
import {
  audioCodecName,
  audioTrackLabel,
  channelLayoutLabel,
  subtitleTrackLabel,
  trackLanguageName,
  trackTitle,
} from "./trackLabels";

const words = { mono: "Mono", stereo: "Stereo", forced: "Forced" };

// These cases mirror clients/android PlayarrTrackLabelsTest.kt: both clients must label tracks alike.
describe("track labels (shared with Android)", () => {
  it("labels a dub as language name, codec label and channel layout", () => {
    expect(
      audioTrackLabel({ label: "deu", language: "deu", codec: "AAC", channelsCount: 2 }, "en", words)
    ).toBe("German · AAC · Stereo");
  });

  it("tells identical language codes apart by codec and layout", () => {
    const a = audioTrackLabel({ label: "eng", language: "eng", codec: "DTS", channelsCount: 8 }, "en", words);
    const b = audioTrackLabel({ label: "eng", language: "eng", codec: "AC3", channelsCount: 2 }, "en", words);
    expect(a).toBe("English · DTS · 7.1");
    expect(b).toBe("English · AC3 · Stereo");
  });

  it("keeps a distinguishing title and drops one that repeats the language", () => {
    expect(
      audioTrackLabel({ label: "Commentary", language: "eng", codec: "AC3", channelsCount: 2 }, "en", words)
    ).toBe("English · Commentary · AC3 · Stereo");
    expect(
      audioTrackLabel({ label: "English TrueHD Atmos", language: "eng", codec: "TrueHD", channelsCount: 6 }, "en", words)
    ).toBe("English · TrueHD · 5.1");
    expect(trackTitle("Audio 2", undefined, undefined)).toBeUndefined();
    expect(trackTitle("eng", "eng", "English")).toBeUndefined();
  });

  it("resolves bibliographic and unknown language codes", () => {
    expect(trackLanguageName("fre", "en")).toBe("French");
    expect(trackLanguageName("deu", "en")).toBe("German");
    expect(trackLanguageName("jpn", "en")).toBe("Japanese");
    expect(trackLanguageName("und", "en")).toBeUndefined();
    expect(trackLanguageName(null, "en")).toBeUndefined();
    expect(trackLanguageName("zzz", "en")).toBe("zzz");
  });

  it("localises the language name", () => {
    expect(trackLanguageName("deu", "ja")).toBe("ドイツ語");
  });

  it("falls back to codec and layout, then to the server label", () => {
    expect(audioTrackLabel({ label: "Audio 1", codec: "AAC", channelsCount: 2 }, "en", words)).toBe("AAC · Stereo");
    expect(audioTrackLabel({ label: "Audio 1" }, "en", words)).toBe("Audio 1");
  });

  it("names codecs and channel layouts", () => {
    expect(audioCodecName("ac3")).toBe("AC3");
    expect(audioCodecName("eac3")).toBe("E-AC3");
    expect(audioCodecName("truehd")).toBe("TrueHD");
    expect(audioCodecName("aac")).toBe("AAC");
    expect(audioCodecName("pcm_s16le")).toBe("PCM");
    expect(audioCodecName(null)).toBeUndefined();
    expect(channelLayoutLabel(1, words)).toBe("Mono");
    expect(channelLayoutLabel(2, words)).toBe("Stereo");
    expect(channelLayoutLabel(6, words)).toBe("5.1");
    expect(channelLayoutLabel(8, words)).toBe("7.1");
    expect(channelLayoutLabel(10, words)).toBe("10 ch");
    expect(channelLayoutLabel(undefined, words)).toBeUndefined();
  });

  it("labels subtitles with language, title and the forced flag", () => {
    expect(subtitleTrackLabel({ label: "SDH", language: "eng" }, "en", words)).toBe("English · SDH");
    expect(subtitleTrackLabel({ label: "eng", language: "eng", forced: true }, "en", words)).toBe("English · Forced");
  });
});
