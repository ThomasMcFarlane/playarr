import type { PlaybackInfo } from "@playarr-tv/api-client";
import type { PlaybackAudioTrack } from "@playarr-tv/player-core";
import { audioCodecName } from "./trackLabels";

/** The audio list the server negotiated (source tracks plus any dub), as picker options. */
export function sourceAudioTracksFromInfo(info: PlaybackInfo): PlaybackAudioTrack[] {
  return info.audio_tracks.map((track) => {
    // The server's profile-refined label ("DTS-HD MA") wins; the raw codec gets the shared readable name.
    const codec = track.codec_label?.trim() || audioCodecName(track.codec);
    return {
      id: track.id,
      label: track.label,
      language: track.language ?? undefined,
      codec,
      roles: [],
      channelsCount: track.channels ?? undefined,
      selected: track.id === info.selected_audio_track_id,
    };
  });
}
