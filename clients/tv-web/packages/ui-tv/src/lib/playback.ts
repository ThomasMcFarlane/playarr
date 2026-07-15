import type { PlaybackMode } from "@streamarr-tv/api-client";

/**
 * Maps the real `PlaybackInfoResponse.mode` ("direct" | "hls") to a MIME
 * type hint for `PlaybackSource.mimeType`. `PlaybackInfoResponse`'s own
 * doc comment describes the URL convention this mirrors: a direct-play
 * response points at a progressive `/stream` file, an `"hls"` response at
 * an `.m3u8` manifest (either a ready rendition or a freshly spawned
 * on-demand transcode session).
 */
export function mimeTypeForPlaybackMode(mode: PlaybackMode): string {
  switch (mode) {
    case "direct":
      return "video/mp4";
    case "hls":
      return "application/x-mpegURL";
  }
}
