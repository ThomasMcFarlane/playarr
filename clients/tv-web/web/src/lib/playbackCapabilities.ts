import type { PlaybackCapabilities } from "@streamarr-tv/api-client/react";

/** Reasonable, documented default for a modern desktop browser's Shaka Player (MSE + EME) pipeline. */
export const WEB_PLAYBACK_CAPABILITIES: PlaybackCapabilities = {
  containers: "mp4,webm,mp3,flac,m4a,ogg,opus,wav",
  videoCodecs: "h264,h265,vp9,av1",
  audioCodecs: "aac,opus,mp3,flac,vorbis,pcm_s16le,pcm_s24le",
};
