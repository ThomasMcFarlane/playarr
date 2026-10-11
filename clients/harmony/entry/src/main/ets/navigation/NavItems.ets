/**
 * The TV nav rail's items, shared by every page that shows the rail (web renders one shell rail on
 * every page). Order and icons follow web `PRODUCT_NAV_GROUPS` and `NavIcons.tsx`; the kinds still
 * come from `GET /api/v1/catalog/kinds`, never a hard-coded list.
 */

import type { NavRailItem } from '../design/components/NavRail';
import type { WorkKind } from '../core/Types/Catalog';
import { ROUTES } from './Routes';
import type { LibraryRouteParams } from './Routes';
import { getNavStack, popRoute, pushRoute, replaceRoute } from './NavStack';

export const HOME_NAV_ID: string = 'home';
export const CALENDAR_NAV_ID: string = 'calendar';
export const SEARCH_NAV_ID: string = 'search';

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
  if (id === CALENDAR_NAV_ID) {
    return $r('app.media.nav_calendar');
  }
  if (id === SEARCH_NAV_ID) {
    return $r('app.media.nav_search');
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

/** Web's Playlists/Watchlist/Requests/Calendar group: only the screens this client has so far. */
export function buildSecondaryNavItems(): NavRailItem[] {
  return [{ id: CALENDAR_NAV_ID, icon: navIconFor(CALENDAR_NAV_ID), label: 'Calendar' }];
}

/** Web's Downloads/Search group, above the library group: only the screens this client has so far. */
export function buildPrimaryNavItems(): NavRailItem[] {
  return [{ id: SEARCH_NAV_ID, icon: navIconFor(SEARCH_NAV_ID), label: 'Search' }];
}

/**
 * One rail tap from the page whose nav id is `currentId`. Home is the root of the TV pages: from Home a
 * destination is pushed; from any other page it replaces that page, and Home pops back.
 */
export function navigateFromRail(id: string, currentId: string): void {
  if (id === currentId) {
    return;
  }
  if (id === HOME_NAV_ID) {
    popRoute(getNavStack());
    return;
  }
  const fromHome = currentId === HOME_NAV_ID;
  if (id === CALENDAR_NAV_ID || id === SEARCH_NAV_ID) {
    const route = id === CALENDAR_NAV_ID ? ROUTES.Calendar : ROUTES.Search;
    if (fromHome) {
      pushRoute(getNavStack(), route);
    } else {
      replaceRoute(getNavStack(), route);
    }
    return;
  }
  const params: LibraryRouteParams = { kind: id };
  if (fromHome) {
    pushRoute(getNavStack(), ROUTES.Library, params);
  } else {
    replaceRoute(getNavStack(), ROUTES.Library, params);
  }
}
