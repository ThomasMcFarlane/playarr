/**
 * One place to flip when a hardware or virtual-device session answers one
 * of design doc §9's open questions. Every flag here backs a real
 * assumption the design explicitly could not verify without a Vega host
 * (§1.3's A2/A4 and §9.2's R11/R12) -- rather than hard-coding the assumed
 * answer at every call site, each call site reads the flag here, so
 * correcting a wrong guess later is a one-line change in this file, never a
 * hunt through screens and components.
 *
 * Every strategy this gates has a working fallback on the other side of it
 * -- flipping any one of these is a performance/fidelity choice, not a
 * "does the app still work" one. See the file each comment cross-references
 * for the fallback's actual implementation once that file exists.
 */
export const CAPABILITIES = {
  /**
   * Assumption A4: does `<Image source={{uri, headers}}>` actually attach
   * `headers` to the underlying native image request on Vega, the way it
   * does on Android/iOS RN? Every Streamarr artwork endpoint requires
   * `Authorization: Bearer`, so if this is false every poster silently
   * renders as a grey box instead of erroring loudly.
   *
   * Assumed true (the RN `<Image>` header contract is old and widely relied
   * on elsewhere in the RN ecosystem, so "no" would be the surprising
   * answer) -- but `components/ArtworkImage.tsx` (a later step) is
   * structured with a `header` | `dataUri` strategy switch keyed off this
   * flag specifically so flipping it to `false` is a one-line change, not a
   * rewrite, the day a real device proves otherwise.
   */
  artworkRequestHeaders: true,

  /**
   * Assumption A2: can `VideoPlayer.src` carry a custom `Authorization`
   * header for progressive (`mode: "direct"`) playback, the way the HLS
   * path can via Shaka's request filter? Amazon documents no such hook, so
   * this is assumed false -- direct MP4 playback of protected content is
   * therefore not attempted at all; HLS (`mode: "hls"`, design doc §6.2's
   * Plan A) is the only playback path this app requests.
   */
  directPlaybackHeaders: false,

  /**
   * R12: does `addTextTrack(kind, label, language, uri, mimeType)` accept
   * an app-private `file://`-style path for a sidecar subtitle track
   * (`platform/media/subtitles.ts`, a later step, would fetch the VTT with
   * a bearer token and write it via `@amazon-devices/kepler-file-system`
   * before handing the local path to `addTextTrack`)? Assumed true --
   * assumed false would not fail loudly either way, since in-band
   * (muxed-into-the-container) caption tracks remain available regardless
   * of this flag; a sidecar-only subtitle track is the one thing that
   * degrades to "temporarily unavailable" rather than erroring if this
   * guess is wrong.
   */
  fileUriSubtitleTracks: true,
} as const;

export type Capabilities = typeof CAPABILITIES;
