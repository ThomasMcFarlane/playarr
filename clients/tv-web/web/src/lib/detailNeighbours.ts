/**
 * Which items to fetch details for around the focused one. Pure, so the choice is tested without a DOM.
 * Every function returns ids nearest first (the order the low-priority lane works in), without the focused
 * item and without duplicates.
 */

export interface HasId {
  id: string;
}

/** Cards each side of the focus that are prefetched along a row. */
export const NEIGHBOUR_REACH = 3;

function unique(ids: Array<string | undefined>, skip: string | undefined): string[] {
  const seen = new Set<string>(skip === undefined ? [] : [skip]);
  const out: string[] = [];
  for (const id of ids) {
    if (id === undefined || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/**
 * A grid of `columns` per row: `reach` cards either side on the focused row, then the cards in the rows
 * directly above and below within `reach` columns of the focus (what the next vertical move can land on).
 */
export function gridNeighbours(items: readonly HasId[], index: number, columns: number, reach = NEIGHBOUR_REACH): string[] {
  const cols = Math.max(1, columns);
  const focused = items[index]?.id;
  const row = Math.floor(index / cols);
  const col = index % cols;
  const candidates: Array<{ id: string; distance: number }> = [];
  for (let dr = -1; dr <= 1; dr += 1) {
    for (let dc = -reach; dc <= reach; dc += 1) {
      const c = col + dc;
      if (c < 0 || c >= cols) continue;
      const at = (row + dr) * cols + c;
      const item = items[at];
      if (!item || at === index) continue;
      // Along the row first, then straight up/down, then the diagonals.
      candidates.push({ id: item.id, distance: Math.abs(dr) * 1.5 + Math.abs(dc) });
    }
  }
  candidates.sort((a, b) => a.distance - b.distance);
  return unique(candidates.map((candidate) => candidate.id), focused);
}

export interface RailLike<T extends HasId> {
  id: string;
  items: readonly T[];
}

/**
 * Rails stacked vertically: `reach` cards either side of the focus on its rail, then the cards the rails
 * directly above and below show (`visible` of them, starting at the card in the focused column).
 */
export function railNeighbours<T extends HasId>(
  rails: readonly RailLike<T>[],
  railId: string,
  itemId: string,
  options: { reach?: number; visible?: number } = {}
): string[] {
  const reach = options.reach ?? NEIGHBOUR_REACH;
  const visible = options.visible ?? 8;
  const railIndex = rails.findIndex((rail) => rail.id === railId);
  if (railIndex < 0) return [];
  const rail = rails[railIndex]!;
  const index = rail.items.findIndex((item) => item.id === itemId);
  if (index < 0) return [];
  const ids: Array<string | undefined> = [];
  for (let d = 1; d <= reach; d += 1) {
    ids.push(rail.items[index + d]?.id, rail.items[index - d]?.id);
  }
  for (const neighbour of [rails[railIndex + 1], rails[railIndex - 1]]) {
    if (!neighbour) continue;
    const start = Math.max(0, Math.min(index, Math.max(0, neighbour.items.length - visible)));
    for (let i = 0; i < visible; i += 1) {
      const at = start + ((i % 2 === 0 ? 1 : -1) * Math.ceil(i / 2));
      ids.push(neighbour.items[at]?.id);
    }
  }
  return unique(ids, itemId);
}

/** Every item, nearest to `focusIndex` first (the idle warm-up order for one flat list). */
export function byDistance(items: readonly HasId[], focusIndex: number): string[] {
  return items
    .map((item, index) => ({ id: item.id, distance: Math.abs(index - focusIndex) }))
    .sort((a, b) => a.distance - b.distance)
    .map((entry) => entry.id);
}

/** All the rails' items, the focused rail first, then outwards by rail distance, each rail from the focus. */
export function railsByDistance<T extends HasId>(rails: readonly RailLike<T>[], railId: string, itemId: string): string[] {
  const railIndex = Math.max(0, rails.findIndex((rail) => rail.id === railId));
  const order = [...rails.keys()].sort((a, b) => Math.abs(a - railIndex) - Math.abs(b - railIndex) || a - b);
  const out: string[] = [];
  for (const at of order) {
    const rail = rails[at]!;
    const focus = at === railIndex ? Math.max(0, rail.items.findIndex((item) => item.id === itemId)) : 0;
    out.push(...byDistance(rail.items, focus));
  }
  return unique(out, itemId);
}
