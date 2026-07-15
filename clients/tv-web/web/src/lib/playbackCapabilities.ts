import type { PlaybackCapabilities } from "@streamarr-tv/api-client/react";

/** Reasonable, documented default for a modern desktop browser's Shaka Player (MSE + EME) pipeline. */
export const WEB_PLAYBACK_CAPABILITIES: PlaybackCapabilities = {
  containers: "mp4,webm",
  videoCodecs: "h264,h265,vp9,av1",
  audioCodecs: "aac,opus",
};
