import { describe, expect, it } from "vitest";
import { en } from "./i18n/translations/en";
import { formatMbps, qualityDisplayLabel } from "./playerQualityLabel";

const t = (key: keyof typeof en, params?: Record<string, string | number>) =>
  Object.entries(params ?? {}).reduce(
    (text, [name, value]) => text.replace(`{{${name}}}`, String(value)),
    en[key] as string
  );

const original = (video_bitrate_bps?: number | null) => ({
  id: "original",
  label: "Original",
  video_bitrate_bps,
});

describe("formatMbps", () => {
  it("formats to one decimal", () => {
    expect(formatMbps(24_300_000)).toBe("24.3");
    expect(formatMbps(8_000_000)).toBe("8.0");
  });

  it("treats zero, negative, tiny and missing values as unknown", () => {
    for (const value of [0, -1, 10_000, null, undefined, Number.NaN]) {
      expect(formatMbps(value)).toBeNull();
    }
  });
});

describe("qualityDisplayLabel", () => {
  it("shows the real source bitrate for Original", () => {
    expect(qualityDisplayLabel(original(24_300_000), t)).toBe("Original · 24.3 Mbps");
  });

  it("shows plain Original when the bitrate is unknown, never 0 Mbps", () => {
    for (const bps of [undefined, null, 0]) {
      const label = qualityDisplayLabel(original(bps), t);
      expect(label).toBe("Original");
      expect(label).not.toContain("0 Mbps");
    }
  });

  it("falls back to Original when no option is selected yet", () => {
    expect(qualityDisplayLabel(undefined, t)).toBe("Original");
  });

  it("keeps the server label for rendition qualities", () => {
    expect(
      qualityDisplayLabel(
        { id: "h264-1080p-8mbps", label: "FHD medium", video_bitrate_bps: 8_000_000 },
        t
      )
    ).toBe("FHD medium");
  });
});
