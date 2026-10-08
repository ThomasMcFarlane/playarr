import type { Work } from "@playarr-tv/api-client";

/** UTC year of an ISO date string (null when missing or unparseable). The one place a year is read from a date. */
export function yearOfDate(value: string | null | undefined): number | null {
  if (!value) return null;
  const year = new Date(value).getUTCFullYear();
  return Number.isFinite(year) && year > 0 ? year : null;
}

/** Four-digit release year from a work's `release_date` (null for artists/authors or unparseable dates). Never the added date. */
export function releaseYear(work: Pick<Work, "release_date">): number | null {
  return yearOfDate(work.release_date);
}

/** "Movie · 2019" style label; falls back to the bare kind label when no year is known. */
export function labelWithYear(
  label: string,
  work: Pick<Work, "release_date">,
): string {
  const year = releaseYear(work);
  return year === null ? label : `${label} · ${year}`;
}
