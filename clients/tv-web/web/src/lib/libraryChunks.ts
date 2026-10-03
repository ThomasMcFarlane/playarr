/**
 * Pure helpers for the memoised library card chunks (see `pages/Library.tsx`).
 * Cards are rendered in fixed-size runs so that mounting more rows or appending
 * a catalogue page only re-renders the chunks whose items actually changed.
 */

/** Cards per chunk; divisible by every column count the views use (1-4, 6, 8). */
export const LIBRARY_CHUNK_SIZE = 24;

/** `[start, end)` card ranges covering `[0, mountedEnd)`. */
export function libraryChunkRanges(
  mountedEnd: number,
  chunkSize = LIBRARY_CHUNK_SIZE
): Array<{ chunk: number; start: number; end: number }> {
  const ranges: Array<{ chunk: number; start: number; end: number }> = [];
  for (let start = 0, chunk = 0; start < mountedEnd; start += chunkSize, chunk += 1) {
    ranges.push({ chunk, start, end: Math.min(mountedEnd, start + chunkSize) });
  }
  return ranges;
}

/**
 * True when a chunk would render identically: same range and same work objects.
 */
export function sameLibraryChunkItems<T>(
  prev: { items: readonly T[]; start: number; end: number },
  next: { items: readonly T[]; start: number; end: number }
): boolean {
  if (prev.start !== next.start || prev.end !== next.end) return false;
  for (let i = prev.start; i < prev.end; i += 1) {
    if (prev.items[i] !== next.items[i]) return false;
  }
  return true;
}
