/**
 * Route-name registry and per-route navigation parameter interfaces (brief
 * section 3.2, "navigation/"). This is the ONE shared contract every page
 * and every sibling slice (Home, Library, Detail, Player, plus the
 * pairing/profiles boot flow) codes against: nothing outside this file
 * ever spells a route name as a bare string literal, and nothing outside
 * this file defines a navigation-parameter shape.
 *
 * `navigation/NavStack.ets` accepts these route names and parameter
 * objects unchanged; `checks/manifests.mjs` (Check 3) cross-references
 * every route name recognised here against
 * `resources/base/profile/router_map.json`, in both directions.
 *
 * All nine names below are wired up: `profile/router_map.json` carries a
 * row for each (plus a `profile/main_pages.json` row for Index and
 * DesignGallery only, which are also standalone entry pages in their own
 * right -- every other route, Player included, is reached exclusively
 * through the shared `NavPathStack`, never `main_pages.json`/`loadContent`),
 * and their page files exist under `pages/`. `Player` (brief 9 "Slice 7")
 * was this file's reservation of the agreed name ahead of the slice that
 * would land its page file and its own `router_map.json` row; that slice
 * is what wires it below, following `pages/Detail.ets`'s own
 * `pushRoute(stack, ROUTES.Player, params)` call, which was written
 * against this exact reservation before the row existed. Every slice that
 * builds one of these screens must read the name back from `ROUTES` here
 * rather than inventing its own spelling, so nothing ever drifts out of
 * step.
 */

import type { QueueItem } from '../core/EndOfPlayback.ts';

/** `pages/Index.ets`. The single boot/root page: owns the shared
 * `NavPathStack` and drives the connect -> pair -> profiles -> home state
 * machine. No navigation parameters. */
export const ROUTE_INDEX: string = 'Index';

/** `pages/DesignGallery.ets`. Debug-only component gallery, excluded from
 * `router_map.json` in release builds. No navigation parameters. */
export const ROUTE_DESIGN_GALLERY: string = 'DesignGallery';

/** `pages/ServerSetup.ets`. Manual server-address entry, shown before
 * pairing whenever `auth/ServerDirectory.ets` has no known address yet. No
 * navigation parameters. */
export const ROUTE_SERVER_SETUP: string = 'ServerSetup';

/** `pages/Pairing.ets`. RFC 8628 device-link screen: user code,
 * verification URI, poll status. No navigation parameters. */
export const ROUTE_PAIRING: string = 'Pairing';

/** `pages/Profiles.ets`. "Who's watching" profile picker: profile grid,
 * PIN prompt, sign-out. No navigation parameters. */
export const ROUTE_PROFILES: string = 'Profiles';

/** `pages/Home.ets`. The signed-in home screen: hero plus continue-watching
 * and new/more movies/series rails. No navigation parameters. */
export const ROUTE_HOME: string = 'Home';

/** `pages/Library.ets`. Per-kind catalogue browse grid, carrying a
 * `LibraryRouteParams`. */
export const ROUTE_LIBRARY: string = 'Library';

/** `pages/Detail.ets`. Work detail sheet, carrying a `DetailRouteParams`. */
export const ROUTE_DETAIL: string = 'Detail';

/** `pages/Player.ets`. XComponent playback surface, custom control chrome
 * and key handling, carrying a `PlayerRouteParams`. Landed by brief 9
 * "Slice 7"; `pages/Detail.ets` already pushes this route by name (its own
 * `playPrimary`/`selectRow` methods), written ahead of this row per this
 * file's own reservation discipline (see the file-header comment). */
export const ROUTE_PLAYER: string = 'Player';

/** `pages/Calendar.ets`. The release calendar (TV agenda). No navigation parameters. */
export const ROUTE_CALENDAR: string = 'Calendar';

/** `pages/Search.ets`. Catalogue search. No navigation parameters. */
export const ROUTE_SEARCH: string = 'Search';

/** `pages/Settings.ets`. The settings workspace. No navigation parameters. */
export const ROUTE_SETTINGS: string = 'Settings';

/**
 * Every route name a page may push, replace or pop by, keyed the same way
 * `router_map.json` names them. Import this object rather than any of the
 * individual constants above; the constants exist only to build this one
 * namespace.
 */
export class RouteNames {
  readonly Index: string = ROUTE_INDEX;
  readonly DesignGallery: string = ROUTE_DESIGN_GALLERY;
  readonly ServerSetup: string = ROUTE_SERVER_SETUP;
  readonly Pairing: string = ROUTE_PAIRING;
  readonly Profiles: string = ROUTE_PROFILES;
  readonly Home: string = ROUTE_HOME;
  readonly Library: string = ROUTE_LIBRARY;
  readonly Detail: string = ROUTE_DETAIL;
  readonly Player: string = ROUTE_PLAYER;
  readonly Calendar: string = ROUTE_CALENDAR;
  readonly Search: string = ROUTE_SEARCH;
  readonly Settings: string = ROUTE_SETTINGS;
}

export const ROUTES: RouteNames = new RouteNames();

/** `pages/Detail.ets`. `workId` identifies the work (movie or series)
 * whose detail sheet to render. */
export interface DetailRouteParams {
  workId: string;
}

/** `pages/Library.ets`. `kind` selects which catalogue grouping to list
 * (a library/collection identifier as understood by `data/CatalogRepository.ets`). */
export interface LibraryRouteParams {
  kind: string;
}

/** `pages/Player.ets`. `mediaFileId` and `workId` together identify the
 * playable file and its parent work; `startPositionMs` resumes from a
 * prior watch position when present and is omitted to start from zero. */
export interface PlayerRouteParams {
  mediaFileId: string;
  workId: string;
  startPositionMs?: number;
  /** Items queued after this one (next episodes); absent or empty means a plain ended card. */
  queue?: QueueItem[];
}
