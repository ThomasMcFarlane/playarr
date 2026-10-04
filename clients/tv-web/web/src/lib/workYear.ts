import type { Work } from "@playarr-tv/api-client";

/** Four-digit release year from a work's `release_date` (null for artists/authors or unparseable dates). */
export function releaseYear(work: Pick<Work, "release_date">): number | null {
  const raw = work.release_date;
  if (!raw) return null;
  const year = new Date(raw).getUTCFullYear();
  return Number.isFinite(year) && year > 0 ? year : null;
}

/** "Movie · 2019" style label; falls back to the bare kind label when no year is known. */
export function labelWithYear(
  label: string,
  work: Pick<Work, "release_date">,
): string {
  const year = releaseYear(work);
  return year === null ? label : `${label} · ${year}`;
}
