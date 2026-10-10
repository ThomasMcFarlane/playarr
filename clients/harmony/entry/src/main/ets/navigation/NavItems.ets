/**
 * The TV nav rail's items, shared by every page that shows the rail (web renders one shell rail on
 * every page). Order and icons follow web `PRODUCT_NAV_GROUPS` and `NavIcons.tsx`; the kinds still
 * come from `GET /api/v1/catalog/kinds`, never a hard-coded list.
 */

import type { NavRailItem } from '../design/components/NavRail';
import type { WorkKind } from '../core/Types/Catalog';

export const HOME_NAV_ID: string = 'home';

const PLACEHOLDER_NAV_ICON: ResourceStr = $r('app.media.playarr_logo');

/** Web's library nav order: Series, Movies, Sites, Music; anything else after. */
const NAV_KIND_ORDER: WorkKind[] = ['series', 'movie', 'site', 'artist'];

function navKindRank(kind: WorkKind): number {
  const rank = NAV_KIND_ORDER.indexOf(kind);
  return rank < 0 ? NAV_KIND_ORDER.length : rank;
}

/** The web nav icon for a nav id; the logo only for kinds web has no icon for. */
export function navIconFor(id: string): ResourceStr {
  if (id === HOME_NAV_ID) {
    return $r('app.media.nav_home');
  }
  if (id === 'series') {
    return $r('app.media.nav_series');
  }
  if (id === 'movie') {
    return $r('app.media.nav_movies');
  }
  if (id === 'artist') {
    return $r('app.media.nav_music');
  }
  return PLACEHOLDER_NAV_ICON;
}

/** Nav label for a catalogue kind (a whole library section). */
export function catalogKindNavLabel(kind: WorkKind): string {
  if (kind === 'movie') {
    return 'Movies';
  }
  if (kind === 'series') {
    return 'Series';
  }
  if (kind === 'site') {
    return 'Sites';
  }
  if (kind === 'artist') {
    return 'Music';
  }
  return 'Books';
}

/** Home first, then the server's kinds in web order. */
export function buildNavRailItems(kinds: WorkKind[]): NavRailItem[] {
  const items: NavRailItem[] = [{ id: HOME_NAV_ID, icon: navIconFor(HOME_NAV_ID), label: 'Home' }];
  const sorted: WorkKind[] = kinds.slice();
  sorted.sort((a: WorkKind, b: WorkKind): number => navKindRank(a) - navKindRank(b));
  for (const kind of sorted) {
    items.push({ id: kind, icon: navIconFor(kind), label: catalogKindNavLabel(kind) });
  }
  return items;
}
