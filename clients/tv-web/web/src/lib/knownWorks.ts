import type { Work } from "@playarr-tv/api-client";

/**
 * Works the app has already shown on a card (library grid, Home rails, search results), by id. A detail page that is
 * still loading uses the entry to draw the real title, kicker and artwork inside its skeleton, so opening a card feels
 * instant and nothing is replaced when the full detail arrives. Memory only, bounded, never persisted.
 */
const MAX_KNOWN = 600;
const known = new Map<string, Work>();

export function rememberWorks(works: readonly Work[] | null | undefined): void {
  if (!works) return;
  for (const work of works) {
    known.delete(work.id);
    known.set(work.id, work);
  }
  while (known.size > MAX_KNOWN) {
    const oldest = known.keys().next().value;
    if (oldest === undefined) break;
    known.delete(oldest);
  }
}

export function knownWork(id: string | undefined): Work | undefined {
  return id ? known.get(id) : undefined;
}
