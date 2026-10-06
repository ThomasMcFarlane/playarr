import type { PlaybackInfo } from "@playarr-tv/api-client";
import type { PlaybackAudioTrack } from "@playarr-tv/player-core";

/** The audio list the server negotiated (source tracks plus any dub), as picker options. */
export function sourceAudioTracksFromInfo(info: PlaybackInfo): PlaybackAudioTrack[] {
  return info.audio_tracks.map((track) => {
    const codec = (track.codec_label ?? track.codec ?? "").trim().toUpperCase();
    return {
      id: track.id,
      label: track.label,
      language: track.language ?? undefined,
      codec: codec || undefined,
      roles: [],
      channelsCount: track.channels ?? undefined,
      selected: track.id === info.selected_audio_track_id,
    };
  });
}

/** Secondary line of an audio picker row: language and codec, whichever are known. */
export function audioTrackDetail(track: { language?: string; codec?: string }): string {
  return [track.language, track.codec].filter(Boolean).join(" · ");
}
