/** Release year (UTC) from an ISO release date, or null when the title has none. Never derived from `added_at`. */
export function releaseYear(releaseDate: string | null | undefined): string | null {
  if (!releaseDate) return null;
  const year = new Date(releaseDate).getUTCFullYear();
  return Number.isFinite(year) && year > 0 ? String(year) : null;
}
