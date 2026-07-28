import { describe, expect, it } from "vitest";
import {
  HDR_DEVICE_CAPABILITY_KEY,
  NARROW_DEVICE_CAPABILITIES,
  NEGOTIATION_PLAYBACK_CAPABILITIES,
  buildDeviceCapabilities,
  type CastCapabilityProbe,
} from "./capabilities";

describe("NEGOTIATION_PLAYBACK_CAPABILITIES", () => {
  it("is always the fixed narrow h264/aac/mp4 profile", () => {
    expect(NEGOTIATION_PLAYBACK_CAPABILITIES).toEqual({
      containers: "mp4",
      videoCodecs: "h264",
      audioCodecs: "aac",
    });
  });
});

describe("buildDeviceCapabilities", () => {
  it("falls back to the narrow default when no probe is available", () => {
    expect(buildDeviceCapabilities(null)).toEqual(NARROW_DEVICE_CAPABILITIES);
    expect(buildDeviceCapabilities(undefined)).toEqual(NARROW_DEVICE_CAPABILITIES);
  });

  it("returns a fresh object, not a shared reference, on the fallback path", () => {
    const first = buildDeviceCapabilities(null);
    const second = buildDeviceCapabilities(null);
    expect(first).not.toBe(second);
    expect(first).not.toBe(NARROW_DEVICE_CAPABILITIES);
  });

  it("reports true only for codecs the probe accepts", () => {
    // Deliberately checks `width`/`height` are both absent, so this fake
    // doesn't also (incorrectly) answer "yes" to the 4K probe below, which
    // reuses this same mimeType/codecs pair at UHD resolution.
    const probe: CastCapabilityProbe = {
      canDisplayType: (mimeType, codecs, width, height) =>
        mimeType === "video/mp4" && codecs === "avc1.640028" && width === undefined && height === undefined,
    };
    expect(buildDeviceCapabilities(probe)).toEqual({
      supportsH264: true,
      supportsHevc: false,
      supportsVp9: false,
      supportsAv1: false,
      supports4k: false,
      supportsHdr: false,
    });
  });

  it("reports every codec the probe accepts, independently", () => {
    const probe: CastCapabilityProbe = {
      canDisplayType: () => true,
    };
    expect(buildDeviceCapabilities(probe)).toEqual({
      supportsH264: true,
      supportsHevc: true,
      supportsVp9: true,
      supportsAv1: true,
      supports4k: true,
      supportsHdr: false,
    });
  });

  it("probes 4K at UHD resolution for either h264 or hevc", () => {
    const seenProbes: Array<{ codecs?: string; width?: number; height?: number }> = [];
    const probe: CastCapabilityProbe = {
      canDisplayType: (_mimeType, codecs, width, height) => {
        seenProbes.push({ codecs, width, height });
        return codecs === "hvc1.1.6.L93.B0" && width === 3840 && height === 2160;
      },
    };
    const result = buildDeviceCapabilities(probe);
    expect(result.supports4k).toBe(true);
    expect(seenProbes.some((p) => p.width === 3840 && p.height === 2160)).toBe(true);
  });

  it("never lets one throwing codec probe suppress the others", () => {
    const probe: CastCapabilityProbe = {
      canDisplayType: (mimeType, codecs) => {
        if (codecs === "hvc1.1.6.L93.B0") throw new Error("unsupported query");
        return mimeType === "video/mp4" && codecs === "avc1.640028";
      },
    };
    const result = buildDeviceCapabilities(probe);
    expect(result.supportsH264).toBe(true);
    expect(result.supportsHevc).toBe(false);
  });

  it("reads supportsHdr from getDeviceCapabilities using the documented key", () => {
    const probe: CastCapabilityProbe = {
      canDisplayType: () => false,
      getDeviceCapabilities: () => ({ [HDR_DEVICE_CAPABILITY_KEY]: true }),
    };
    expect(buildDeviceCapabilities(probe).supportsHdr).toBe(true);
  });

  it("treats a missing or throwing getDeviceCapabilities as no HDR support", () => {
    const probeMissing: CastCapabilityProbe = { canDisplayType: () => false };
    expect(buildDeviceCapabilities(probeMissing).supportsHdr).toBe(false);

    const probeThrows: CastCapabilityProbe = {
      canDisplayType: () => false,
      getDeviceCapabilities: () => {
        throw new Error("not ready yet");
      },
    };
    expect(buildDeviceCapabilities(probeThrows).supportsHdr).toBe(false);
  });

  it("does not treat a truthy non-boolean HDR value as supported", () => {
    const probe: CastCapabilityProbe = {
      canDisplayType: () => false,
      getDeviceCapabilities: () => ({ [HDR_DEVICE_CAPABILITY_KEY]: "yes" }),
    };
    expect(buildDeviceCapabilities(probe).supportsHdr).toBe(false);
  });
});
