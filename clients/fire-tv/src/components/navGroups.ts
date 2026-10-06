/**
 * `NavRail.tsx`'s data model, extracted into its own dependency-free module
 * for the same reason `tvStageGeometry.ts`/`scrollEdges.ts` are: so the
 * genuinely pure part -- which nav items are actually visible given the
 * server's advertised catalogue kinds -- can be unit-tested without
 * touching `@amazon-devices/react-native-svg` (this app's nav icons) or
 * `@amazon-devices/react-native-kepler` (focus), neither of which can be
 * imported outside a real Kepler host under Jest (see `tvStageGeometry.ts`'s
 * doc comment for the exact failure).
 *
 * Ported from `NAV_GROUPS` in `clients/tv-web/web/src/App.tsx`, with one
 * deliberate omission: the `downloads` item. Design doc §7's own words,
 * confirmed against the Foundation-stage `navigation/routes.ts` this module
 * imports from: "Nav rail groups mirror `NAV_GROUPS` in tv-web's `App.tsx` --
 * `search` → `[/search]` (downloads dropped) ...". `/downloads` itself is
 * out of scope for this client entirely (design doc §7: "IndexedDB offline
 * engine; no Vega equivalent, and a Stick has little storage"), so there is
 * no `ROUTES.downloads` to reference here even if this file wanted to keep
 * that group member.
 */
import type {WorkKind} from '@playarr-tv/api-client';
import {ROUTES, type RouteName} from '../navigation/routes';

/** Names one of `NavRail.tsx`'s own SVG glyphs -- kept as a closed string union here (rather than a component reference) precisely so this module stays free of any `react-native-svg` import; `NavRail.tsx` is the only file that maps these names to actual `<Path>` markup. */
export type NavIconName = 'home' | 'series' | 'movies' | 'sites' | 'music' | 'search' | 'playlists';

export interface NavItem {
  route: RouteName;
  /**
   * English copy only -- this build-order pass has no `i18n/LanguageProvider`
   * yet (design doc §10 step 8, a later, separate step). Wiring these
   * through `useLanguage()`'s `t()` instead is that step's job, once it
   * exists; hard-coding English now is an honest reflection of what is
   * actually available today, not a permanent decision about how this
   * label should be sourced.
   */
  label: string;
  icon: NavIconName;
  /** Present only for the `library` group's items -- gates visibility on `availableWorkKinds`, exactly mirroring `NAV_GROUPS`' own `workKind` field in `App.tsx`. */
  workKind?: WorkKind;
}

export interface NavGroup {
  id: 'search' | 'library' | 'playlists';
  items: readonly NavItem[];
}

/** The full, ungated nav item list -- `visibleNavGroups` below is what actually decides what a given screen renders. */
export const NAV_GROUPS: readonly NavGroup[] = [
  {
    id: 'search',
    items: [{route: ROUTES.search, label: 'Search', icon: 'search'}],
  },
  {
    id: 'library',
    items: [
      {route: ROUTES.home, label: 'Home', icon: 'home'},
      {route: ROUTES.series, label: 'Series', icon: 'series', workKind: 'series'},
      {route: ROUTES.movies, label: 'Movies', icon: 'movies', workKind: 'movie'},
      {route: ROUTES.sites, label: 'Sites', icon: 'sites', workKind: 'site'},
      {route: ROUTES.music, label: 'Music', icon: 'music', workKind: 'artist'},
    ],
  },
  {
    id: 'playlists',
    items: [{route: ROUTES.playlists, label: 'Playlists', icon: 'playlists'}],
  },
] as const;

/**
 * Filters `groups` (defaulting to the real `NAV_GROUPS` above) down to what
 * should actually render, given the server's advertised `GET
 * /api/v1/catalog/kinds` response:
 *
 *  - `null` means "not resolved yet" (the initial state before that request
 *    completes, or a device with no server known at all) -- design doc §7's
 *    "gated on `availableWorkKinds`" is deliberately all-or-nothing here,
 *    matching `App.tsx`'s own `availableWorkKinds !== null` guard around
 *    the whole `<nav>`: rendering a half-correct nav rail for one frame
 *    before the real answer arrives is worse than rendering nothing.
 *  - Once resolved, an item with a `workKind` renders only if that kind is
 *    in the set; an item with no `workKind` (search, home, playlists) is
 *    unconditional.
 *  - A group that ends up with zero visible items after filtering is
 *    dropped entirely, so `NavRail.tsx` never renders an empty pill group.
 */
export function visibleNavGroups(
  availableWorkKinds: ReadonlySet<WorkKind> | null,
  groups: readonly NavGroup[] = NAV_GROUPS
): readonly NavGroup[] {
  if (availableWorkKinds === null) return [];
  return groups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => !item.workKind || availableWorkKinds.has(item.workKind)),
    }))
    .filter((group) => group.items.length > 0);
}
