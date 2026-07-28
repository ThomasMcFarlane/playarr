/**
 * Device-capability profiles for the Playarr Cast receiver.
 *
 * There are deliberately TWO independent profiles built here, and they must
 * stay decoupled:
 *
 * 1. `NEGOTIATION_PLAYBACK_CAPABILITIES` -- always the same fixed, narrow
 *    h264/aac/mp4 profile, sent verbatim on every playback negotiation
 *    (`GET /api/v1/playback/{media_file_id}`) regardless of what this
 *    device can actually decode. Per the Playarr Cast design's Ground
 *    Truth: "declare a narrow decode-capability profile (h264/aac/mp4) when
 *    negotiating so the server is more likely to choose direct play over an
 *    on-demand transcode." Direct play needs no `Authorization` header at
 *    all (self-authenticating via `?playback_session_id=`) and sidesteps
 *    the on-demand-HLS cold-start race entirely -- landing there is worth
 *    more than accurately advertising every codec this hardware can decode.
 * 2. `buildDeviceCapabilities` -- an honest, probed report of what this
 *    specific device can really decode, used only for the `ready` custom-
 *    channel message's `deviceCapabilities` (informational, for the sender
 *    UI/future format-aware decisions). Falls back to the same fixed narrow
 *    profile only when probing itself is unavailable (e.g. this code
 *    running outside a real Cast device runtime, such as under test).
 *
 * Conflating the two would defeat the whole point of (1): a real device
 * that happens to support HEVC must NOT cause negotiation to advertise
 * HEVC, or the server may hand back a source the narrow-profile bias was
 * specifically trying to avoid needing HLS/auth complexity for.
 */
import type { PlaybackInfoParams } from "@playarr-tv/api-client";
import type { PlayarrCastDeviceCapabilities } from "@playarr-tv/cast-protocol";

/** Always used for playback negotiation -- see this file's module doc comment. Never derived from real probing. */
export const NEGOTIATION_PLAYBACK_CAPABILITIES: Pick<
  PlaybackInfoParams,
  "containers" | "videoCodecs" | "audioCodecs"
> = {
  containers: "mp4",
  videoCodecs: "h264",
  audioCodecs: "aac",
};

/** The `ready` message's fallback when `CastReceiverContext.canDisplayType` probing is unavailable at all. */
export const NARROW_DEVICE_CAPABILITIES: PlayarrCastDeviceCapabilities = {
  supportsH264: true,
  supportsHevc: false,
  supportsVp9: false,
  supportsAv1: false,
  supports4k: false,
  supportsHdr: false,
};

/**
 * Minimal shape this module needs from `cast.framework.CastReceiverContext`.
 * Deliberately a hand-rolled structural interface rather than the ambient
 * ("chromecast-caf-receiver") ~SDK type: those types only exist as a real
 * runtime `cast` global once `cast_receiver_framework.js` has loaded in an
 * actual Cast device Chromium -- referencing them here would make this
 * module untestable under plain vitest (no such global exists in Node).
 */
export interface CastCapabilityProbe {
  canDisplayType(mimeType: string, codecs?: string, width?: number, height?: number): boolean;
  /**
   * Mirrors `CastReceiverContext.getDeviceCapabilities()`'s return shape --
   * keyed by the same string constants as `cast.framework.system
   * .DeviceCapabilities` (e.g. `"is_hdr_supported"`, see
   * `HDR_DEVICE_CAPABILITY_KEY` below) -- without this file depending on
   * that ambient enum at runtime.
   */
  getDeviceCapabilities?: () => Record<string, unknown> | null | undefined;
}

/** `cast.framework.system.DeviceCapabilities.IS_HDR_SUPPORTED`'s literal string value, duplicated here so this module has no runtime dependency on the ambient CAF SDK enum -- see `CastCapabilityProbe`'s doc comment. */
export const HDR_DEVICE_CAPABILITY_KEY = "is_hdr_supported";

/** 4K probe resolution. */
const UHD_WIDTH = 3840;
const UHD_HEIGHT = 2160;

// Representative, widely-used codec strings for feature probing (the same
// style `canDisplayType`/`MediaSource.isTypeSupported` callers commonly use
// elsewhere): a real mid-tier profile/level for each codec, not the most
// permissive one, so a probe answering "true" is a meaningful signal.
const H264_PROBE = { mimeType: "video/mp4", codecs: "avc1.640028" } as const;
const HEVC_PROBE = { mimeType: "video/mp4", codecs: "hvc1.1.6.L93.B0" } as const;
const VP9_PROBE = { mimeType: "video/webm", codecs: "vp09.00.10.08" } as const;
const AV1_PROBE = { mimeType: "video/mp4", codecs: "av01.0.04M.08" } as const;

function probeSafely(fn: () => boolean): boolean {
  try {
    return fn();
  } catch {
    // A throwing probe (unsupported query shape on some platform) is
    // exactly as informative as "no" for a capability report.
    return false;
  }
}

/**
 * Builds an honest report of this device's real decode capabilities for the
 * `ready` message. Falls back to `NARROW_DEVICE_CAPABILITIES` wholesale only
 * when `probe` itself is unavailable; each individual codec probe below is
 * independently guarded so one throwing probe can't take the others down
 * with it.
 */
export function buildDeviceCapabilities(
  probe: CastCapabilityProbe | null | undefined
): PlayarrCastDeviceCapabilities {
  if (!probe) return { ...NARROW_DEVICE_CAPABILITIES };

  const supportsH264 = probeSafely(() => probe.canDisplayType(H264_PROBE.mimeType, H264_PROBE.codecs));
  const supportsHevc = probeSafely(() => probe.canDisplayType(HEVC_PROBE.mimeType, HEVC_PROBE.codecs));
  const supportsVp9 = probeSafely(() => probe.canDisplayType(VP9_PROBE.mimeType, VP9_PROBE.codecs));
  const supportsAv1 = probeSafely(() => probe.canDisplayType(AV1_PROBE.mimeType, AV1_PROBE.codecs));
  const supports4k = probeSafely(
    () =>
      probe.canDisplayType(H264_PROBE.mimeType, H264_PROBE.codecs, UHD_WIDTH, UHD_HEIGHT) ||
      probe.canDisplayType(HEVC_PROBE.mimeType, HEVC_PROBE.codecs, UHD_WIDTH, UHD_HEIGHT)
  );

  let supportsHdr = false;
  try {
    supportsHdr = probe.getDeviceCapabilities?.()?.[HDR_DEVICE_CAPABILITY_KEY] === true;
  } catch {
    supportsHdr = false;
  }

  return { supportsH264, supportsHevc, supportsVp9, supportsAv1, supports4k, supportsHdr };
}
