import type { PlaybackQualityOption } from "@playarr-tv/api-client";
import type { TranslationKey } from "./i18n/translations";

/** Formats a bits-per-second figure as Mbps with one decimal, or null when unknown. */
export function formatMbps(bps: number | null | undefined): string | null {
  if (typeof bps !== "number" || !Number.isFinite(bps) || bps <= 0) return null;
  const mbps = bps / 1_000_000;
  if (mbps < 0.05) return null;
  return mbps.toFixed(1);
}

/** Rendition qualities carry a target bitrate; `original` carries the source's real one. */
export function isOriginalQuality(option: Pick<PlaybackQualityOption, "id"> | undefined): boolean {
  return option?.id === "original";
}

type Translate = (key: TranslationKey, params?: Record<string, string | number>) => string;

/**
 * Label shown for a quality. Original reads "Original · 24.3 Mbps" when the
 * server reports the source's bitrate (`video_bitrate_bps`) and plain
 * "Original" when it is unknown or zero. Other qualities keep their label.
 */
export function qualityDisplayLabel(
  option: Pick<PlaybackQualityOption, "id" | "label" | "video_bitrate_bps"> | undefined,
  t: Translate
): string {
  if (!option || isOriginalQuality(option)) {
    const mbps = formatMbps(option?.video_bitrate_bps);
    return mbps
      ? t("components.player.controls.originalWithBitrate", { bitrate: mbps })
      : t("components.player.controls.original");
  }
  return option.label;
}
