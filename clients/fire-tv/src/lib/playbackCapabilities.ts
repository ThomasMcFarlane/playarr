/**
 * The Vega codec/container capability set advertised to `GET /api/v1/playback/{media_file_id}`.
 *
 * The first design advertised nothing, to force `mode: "hls"` on every title, because `VideoPlayer.src` cannot carry an
 * `Authorization` header and Shaka's request filter can. That does not hold up on a real server: HLS needs an on-demand
 * transcode, and a node with no transcode capacity answers 503 `no_transcode_capacity`, so nothing played at all. A direct
 * stream URL needs no header: the negotiation response embeds a `playback_session_id` in it and the media endpoint
 * accepts that alone (checked against the live server with an unauthenticated ranged GET: 206). So the device advertises
 * what its decoders really play and the server picks `direct` whenever it can, falling back to HLS through Shaka (with
 * the header filter) only when the file's container or codec is not in this list.
 *
 * Fire TV Stick 4K Select (Vega OS): H.264 and HEVC in MP4, Matroska and MPEG-TS, with AAC and Dolby audio.
 */
import type {PlaybackCapabilities} from '@playarr-tv/api-client/react';

export const VEGA_PLAYBACK_CAPABILITIES: PlaybackCapabilities = {
  containers: 'mp4,m4v,mov,mkv,ts,mp3,m4a,flac',
  videoCodecs: 'h264,hevc',
  audioCodecs: 'aac,eac3,ac3,mp3,flac,opus,pcm_s16le,pcm_s24le',
};
