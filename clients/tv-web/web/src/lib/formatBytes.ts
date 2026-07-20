/**
 * Human-readable byte size formatting shared by the downloads surfaces
 * (`DownloadQualityDrawer`, `Downloads` page, `MediaContextMenu`'s download
 * action). Binary (1024-based) units, one decimal place above the smallest
 * unit -- matches how OS file managers and most download UIs present sizes.
 */
const UNITS = ["B", "KB", "MB", "GB", "TB"] as const;

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes) || bytes < 0) {
    return "--";
  }
  if (bytes === 0) return "0 B";

  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < UNITS.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const decimals = unitIndex === 0 ? 0 : value < 10 ? 2 : value < 100 ? 1 : 0;
  return `${value.toFixed(decimals)} ${UNITS[unitIndex]}`;
}

/** `formatBytes` prefixed with `~` for an estimated (not exact) size. */
export function formatEstimatedBytes(bytes: number | null | undefined): string {
  const formatted = formatBytes(bytes);
  return formatted === "--" ? formatted : `~${formatted}`;
}
