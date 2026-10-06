import { describe, expect, it } from "vitest";
import type { PlaybackInfo } from "@playarr-tv/api-client";
import { sourceAudioTracksFromInfo } from "./sourceAudioTracks";
import { audioTrackLabel } from "./trackLabels";

const info = {
  selected_audio_track_id: "source-audio-1",
  audio_tracks: [
    { id: "source-audio-1", stream_index: 1, label: "English", language: "eng", codec: "aac", codec_label: "AAC", channels: 2, is_default: true },
    { id: "dub-deu", stream_index: 9, label: "Test Movie A (German dub)", language: "deu", codec: "ac3", codec_label: null, channels: 1, is_default: false },
    { id: "bare", stream_index: 10, label: "Unknown", language: null, codec: null, codec_label: null, channels: null, is_default: false },
  ],
} as unknown as PlaybackInfo;

describe("source audio tracks", () => {
  it("carries the codec, preferring the server label and falling back to the raw codec name", () => {
    const tracks = sourceAudioTracksFromInfo(info);
    expect(tracks.map((t) => t.codec)).toEqual(["AAC", "AC3", undefined]);
    expect(tracks[1]).toMatchObject({ label: "Test Movie A (German dub)", language: "deu", selected: false });
    expect(tracks[0]?.selected).toBe(true);
  });

  it("labels a dub like the Android client: language name, codec, channel layout", () => {
    const [eng, dub, bare] = sourceAudioTracksFromInfo(info);
    const words = { mono: "Mono", stereo: "Stereo" };
    expect(audioTrackLabel(eng!, "en", words)).toBe("English · AAC · Stereo");
    expect(audioTrackLabel(dub!, "en", words)).toBe("German · AC3 · Mono");
    expect(audioTrackLabel(bare!, "en", words)).toBe("Unknown");
  });
});
