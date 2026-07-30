import type {
  FolderBrowseResponse,
  FolderEntry,
} from "@playarr-tv/api-client";

export function folderEntryKey(entry: FolderEntry): string {
  return `${entry.entry_type}:${entry.path}:${entry.media_file_id ?? ""}`;
}

export function mergeFolderBrowsePages(
  current: FolderBrowseResponse,
  next: FolderBrowseResponse
): FolderBrowseResponse {
  const keys = new Set(current.entries.map(folderEntryKey));
  return {
    ...next,
    entries: [
      ...current.entries,
      ...next.entries.filter((entry) => !keys.has(folderEntryKey(entry))),
    ],
    offset: 0,
    total: Math.max(current.total, next.total),
  };
}

export function formatFolderDuration(
  durationMs?: number | null
): string | null {
  if (
    durationMs === null ||
    durationMs === undefined ||
    !Number.isFinite(durationMs) ||
    durationMs < 0
  ) {
    return null;
  }
  const totalSeconds = Math.floor(durationMs / 1_000);
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
    : `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function formatFolderFileSize(sizeBytes?: number | null): string | null {
  if (
    sizeBytes === null ||
    sizeBytes === undefined ||
    !Number.isFinite(sizeBytes) ||
    sizeBytes < 0
  ) {
    return null;
  }
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = sizeBytes;
  let unitIndex = 0;
  while (value >= 1_000 && unitIndex < units.length - 1) {
    value /= 1_000;
    unitIndex += 1;
  }
  return `${value >= 10 || unitIndex === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unitIndex]}`;
}
