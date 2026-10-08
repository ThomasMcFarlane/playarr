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

/**
 * "2011" for a title with a release year, "2011–2019" for an ended series that closed in a later year
 * (`end_date` is only set by the server once the source reports the series as ended). Null without a release year.
 */
export function yearRangeLabel(
  work: Pick<Work, "release_date"> & { end_date?: string | null },
): string | null {
  const start = releaseYear(work);
  if (start === null) return null;
  const end = yearOfDate(work.end_date);
  return end !== null && end > start ? `${start}\u2013${end}` : String(start);
}

/** "Movie · 2019" (or "Series · 2011–2019") label; falls back to the bare kind label when no year is known. */
export function labelWithYear(
  label: string,
  work: Pick<Work, "release_date"> & { end_date?: string | null },
): string {
  const years = yearRangeLabel(work);
  return years === null ? label : `${label} · ${years}`;
}
