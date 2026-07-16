import type { PlaybackCapabilities } from "@streamarr-tv/api-client/react";
import { IS_VIDAA } from "./clientPlatform";

/** Reasonable, documented default for a modern desktop browser's Shaka Player (MSE + EME) pipeline. */
const BROWSER_PLAYBACK_CAPABILITIES: PlaybackCapabilities = {
  containers: "mp4,webm,mp3,flac,m4a,ogg,opus,wav",
  videoCodecs: "h264,h265,vp9,av1",
  audioCodecs: "aac,opus,mp3,flac,vorbis,pcm_s16le,pcm_s24le",
};

/** Conservative common subset for VIDAA's embedded browser and media pipeline. */
const VIDAA_PLAYBACK_CAPABILITIES: PlaybackCapabilities = {
  containers: "mp4,webm,mp3,m4a",
  videoCodecs: "h264,h265,vp9",
  audioCodecs: "aac,opus,mp3",
};

export const WEB_PLAYBACK_CAPABILITIES: PlaybackCapabilities = IS_VIDAA
  ? VIDAA_PLAYBACK_CAPABILITIES
  : BROWSER_PLAYBACK_CAPABILITIES;
