import type { PlaybackCapabilities } from "@streamarr-tv/api-client/react";
import {
  PLAYARR_CLIENT_PLATFORM,
  type PlayarrWebPlatform,
} from "./clientPlatform";

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

/** Conservative direct-play subset common to current LG webOS TV models. */
const WEBOS_PLAYBACK_CAPABILITIES: PlaybackCapabilities = {
  containers: "mp4,mp3,m4a",
  videoCodecs: "h264,h265",
  audioCodecs: "aac,mp3",
};

/** Conservative direct-play subset for Samsung AVPlay across supported Tizen generations. */
const TIZEN_PLAYBACK_CAPABILITIES: PlaybackCapabilities = {
  containers: "mp4,mp3,m4a",
  videoCodecs: "h264,h265",
  audioCodecs: "aac,mp3",
};

export function playbackCapabilitiesForPlatform(
  platform: PlayarrWebPlatform
): PlaybackCapabilities {
  switch (platform) {
    case "tv-vidaa":
      return VIDAA_PLAYBACK_CAPABILITIES;
    case "tv-webos":
      return WEBOS_PLAYBACK_CAPABILITIES;
    case "tv-tizen":
      return TIZEN_PLAYBACK_CAPABILITIES;
    default:
      return BROWSER_PLAYBACK_CAPABILITIES;
  }
}

export const WEB_PLAYBACK_CAPABILITIES: PlaybackCapabilities =
  playbackCapabilitiesForPlatform(PLAYARR_CLIENT_PLATFORM);
