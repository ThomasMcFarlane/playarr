/**
 * Web's `lib/workYear.ts` `yearRangeLabel`: "2011" for a title with a release year, "2011–2019" for an ended series
 * that closed in a later year. Never the added date. (Copied: Metro only watches tv-web's i18n folder.)
 */
export function yearRangeLabel(work: {release_date?: string | null; end_date?: string | null}): string | null {
  const year = (value: string | null | undefined): number | null => {
    if (!value) return null;
    const y = new Date(value).getUTCFullYear();
    return Number.isFinite(y) && y > 0 ? y : null;
  };
  const start = year(work.release_date);
  if (start === null) return null;
  const end = year(work.end_date);
  return end !== null && end > start ? `${start}–${end}` : String(start);
}
