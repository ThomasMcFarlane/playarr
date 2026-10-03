import type { BackupRunStatus, BackupSummary } from "@playarr-tv/api-client";

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "unknown";
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${unit === 0 ? value : value.toFixed(1)} ${units[unit]}`;
}

export type BackupBadge = { label: string; className: string };

/** Complete, partial (labelled) or incomplete (never restorable). */
export function backupBadge(backup: Pick<BackupSummary, "complete" | "partial">): BackupBadge {
  if (!backup.complete) return { label: "Incomplete", className: "badge badge-danger" };
  if (backup.partial) return { label: "Partial", className: "badge badge-warning" };
  return { label: "Complete", className: "badge badge-success" };
}

const PHASES: Record<string, string> = {
  starting: "Starting",
  preflight: "Checking free space",
  snapshot: "Taking a consistent database snapshot",
  assets: "Copying server-managed assets",
  archive: "Compressing and encrypting",
  publish: "Verifying and publishing",
  retention: "Applying retention",
};

export function describePhase(run: Pick<BackupRunStatus, "phase" | "bytes_staged">): string {
  const phase = PHASES[run.phase] ?? run.phase;
  return run.bytes_staged > 0 ? `${phase} (${formatBytes(run.bytes_staged)} staged)` : phase;
}

export function scheduleSummary(hours: number | null | undefined): string {
  if (hours === null || hours === undefined) return "Manual only";
  if (hours % 24 === 0) return hours === 24 ? "Daily" : `Every ${hours / 24} days`;
  return hours === 1 ? "Hourly" : `Every ${hours} hours`;
}

/** Safe file name for a browser download. */
export function downloadName(backup: Pick<BackupSummary, "archive_name">): string {
  return backup.archive_name.replace(/[^A-Za-z0-9._-]/g, "_");
}
