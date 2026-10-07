/**
 * The Vega codec/container capability set advertised to
 * `GET /api/v1/playback/{media_file_id}` (design doc §6.2's Plan A: "steers
 * ... toward `mode: "hls"`"), the same shape as `clients/tv-web/web/src/lib/
 * playbackCapabilities.ts`'s per-platform constants, but built for the
 * opposite goal to every one of those. Every other platform's constant
 * there (browser/VIDAA/webOS/Tizen) advertises a REAL, conservative subset
 * of what that device's native decoder can play, so the server hands back
 * `mode: "direct"` whenever it genuinely can -- the fastest, simplest path.
 * Vega deliberately wants the opposite: direct play of PROTECTED content
 * has no working auth path at all (design doc §6.1's table: `VideoPlayer.
 * src` cannot carry a header, assumption A2), whereas the HLS path can
 * authenticate every request through Shaka's `registerRequestFilter`
 * (design doc §6.2's Plan A). So this file's whole job is making the
 * server's own mode decision come out "hls" every single time, regardless
 * of what the source file's real container/codec are.
 *
 * That decision is entirely mechanical, confirmed directly against the
 * server's own logic rather than assumed:
 * `backend/crates/streamarr-transcode/src/lib.rs`'s
 * `TranscodeOrchestrator::can_direct_play` computes
 * `container_ok = capabilities.supported_containers.iter().any(|c| c.eq_ignore_ascii_case(&media_file.container))`
 * -- an EMPTY `supported_containers` list makes `.any(...)` false for every
 * possible `media_file.container`, so `container_ok` is always false,
 * `can_direct_play` always returns `false`, and
 * `backend/crates/streamarr-api/src/playback.rs`'s `playback_info_handler`
 * falls through to `mode: PlaybackMode::Hls` every time -- with no need to
 * also starve `videoCodecs`/`audioCodecs` (though this file does anyway,
 * for clarity: an all-empty capability set reads unambiguously as "cannot
 * direct-play anything", not as an accident of one field being forgotten).
 *
 * `audioCodecs` is the one field genuinely populated below despite that --
 * `PlaybackInfoParams.audioCodecs`'s own doc comment (`@playarr-tv/
 * api-client`) states it is "informational only today", not load-bearing
 * for the direct-play decision (`can_direct_play` only ever matches it
 * against `media_file.codec`, which is the VIDEO codec -- an audio codec
 * name essentially never collides with one), so listing Vega's real decoder
 * support here costs nothing and keeps this file honest about what the
 * device can actually decode, for whenever a future server change makes
 * that field load-bearing too.
 */
import type {PlaybackCapabilities} from '@playarr-tv/api-client/react';

/**
 * Deliberately empty `containers`/`videoCodecs` -- see this file's top
 * comment for exactly why that guarantees `mode: "hls"`. `audioCodecs`
 * lists Amazon's documented Vega/Fire TV decoder support (AAC and Dolby's
 * own codecs are the two safe, broadly-supported bets across the Fire TV
 * Stick line; PCM/FLAC are included as lossless fallbacks Shaka/HLS's own
 * `mp4a`/`ec-3` codec strings cover cleanly).
 */
export const VEGA_PLAYBACK_CAPABILITIES: PlaybackCapabilities = {
  containers: '',
  videoCodecs: '',
  audioCodecs: 'aac,eac3,ac3,mp3,flac,opus,pcm_s16le,pcm_s24le',
};
