/**
 * The signed-in home screen (brief section 5.9 "TV stage geometry", section
 * 9 Slice 6 acceptance). Pushed onto the shared `NavPathStack`
 * (`navigation/NavStack.ets`) as the `Home` route (`navigation/Routes.ets`'s
 * `ROUTES.Home`) -- it carries no route parameters, matching that file's own
 * note that Home is one of the five no-parameter routes.
 *
 * ## What this page does
 *
 * Issues, in this order, via `data/CatalogRepository.ets` only (this file
 * never imports `net/`/`auth/` directly, brief section 3.1):
 * 1. `GET /api/v1/playback/progress` (`getContinueWatching()`), hydrated to
 *    up to 10 `part_watched` works.
 * 2. `?kind=movie&sort=recent&limit=12&offset=0`.
 * 3. `?kind=series&sort=recent&limit=12&offset=0`.
 * 4. `?kind=movie&sort=recent&limit=12&offset=12`.
 * 5. `?kind=series&sort=recent&limit=12&offset=12`.
 * 6. `GET /api/v1/catalog/kinds` (`getCatalogKinds()`), driving the nav
 *    destinations (never a hard-coded kind list).
 *
 * These six are fetched CONCURRENTLY (brief risk R14: "a later Home screen
 * issues six rails' worth of concurrent fetches" -- `net/HttpTransport.ets`'s
 * own header comment names this exact count): every `getXxx(...)` call below
 * is invoked and its returned `Promise` captured to a local BEFORE any of
 * them is `await`ed, so every request is already in flight by the time the
 * first `await` below actually suspends this function -- `available_only=true`
 * is attached to every catalogue call by `CatalogRepository.ets` itself, this
 * file never repeats that literal.
 *
 * If every rail (continue-watching plus all four catalogue rails) comes back
 * empty, this page `replaceRoute`s to `ROUTES.Library` rather than rendering
 * a dead page (brief 9's own words), defaulting to the first kind
 * `getCatalogKinds()` reported, or `"movie"` if that call itself failed too.
 * Separately -- and this is a deliberate, documented ADDITION beyond that one
 * line of brief text, not a literal requirement -- if all five of those calls
 * come back as a `network_failure` (a genuine connectivity problem, not
 * merely "the catalogue happens to be empty"), this page shows `AsyncState`'s
 * `Error` state with a retry that re-runs the whole load, rather than
 * silently bouncing to a `Library` screen that would just hit the identical
 * failure again. Both fallbacks read `result.kind` directly (`'ok'` /
 * `'network_failure'` / `'http_failure'`) rather than importing `isApiOk`
 * from `net/ApiResult.ets` -- exactly the "branch structurally, never import
 * the union" discipline `pages/Library.ets`'s own header comment already
 * establishes for this same layering rule.
 *
 * ## Hero (`design/components/Stage.ets`)
 *
 * The hero work is whichever item is FIRST across continue-watching, new
 * movies, new series, more movies, more series, in that order -- i.e. the
 * same item that heads the topmost rendered rail. Its key art is resolved
 * through `data/ArtworkRepository.ets#fetchWorkArtworkByPriority` with
 * `HERO_ARTWORK_PRIORITY` (`[backdrop, poster]`, brief 4.9) and fed to
 * `Stage`'s `keyArt` prop, which this same change widens from `ResourceStr`
 * alone to also accept the resulting `image.PixelMap` -- see that file's own
 * updated doc comment on `keyArt` for why that widening was necessary and
 * safe. As on web TV Home, the hero shows the work's synopsis and there is no
 * play button on the stage: selecting a card opens it.
 *
 * ## Rails (`design/components/MediaRail.ets`) and cards
 * (`design/components/PosterCard.ets`)
 *
 * Card artwork uses `LANDSCAPE_ARTWORK_PRIORITY` (`[backdrop, thumb,
 * poster]`, brief 4.9). Every rail's artwork fetches also run concurrently,
 * fired (not awaited) from `startArtworkLoading()` immediately once the main
 * six-call batch resolves; each card patches its OWN `HomeCardItem` in place
 * (a fresh array, never a mutated one, so `@State` reactivity is guaranteed
 * regardless of `Map`/array mutation-observability nuances the design
 * components elsewhere leave as a documented, unverified assumption) as its
 * own fetch resolves, so a rail's cards reveal their artwork progressively
 * rather than the whole rail waiting on its slowest image.
 *
 * A poster-card tap always pushes `ROUTES.Detail` with `{workId}` (brief 9),
 * on every rail, TV and touch alike.
 *
 * ## Device profile split (brief section 6, 9 Slice 6)
 *
 * TV (`this.deviceProfile.metricsKey === 'tv'`): `Stage` fills the screen,
 * with every non-empty rail stacked into its `railsSlot` (brief 5.9's own
 * `homeRailsColumn*` figures describe a wider, full-height column than
 * `Stage`'s compact glass rail panel -- `Stage.ets`'s own header comment
 * explicitly leaves reconciling the two to "the Home page slice", i.e. this
 * file, and this file's reasoned choice is to place rails inside the rail
 * panel `Stage` already renders, spaced by
 * `TvGeometry.homeRailsColumnRowGap`, the one number brief 5.9 gives for
 * rail-to-rail spacing). `design/components/NavRail.ets` sits as a sibling in
 * the same full-bleed `Stack`, per that file's own "expected to be placed as
 * a sibling of Stage" contract. Up from every card in the TOPMOST rendered
 * rail is wired, via `.nextFocus({ up })`, to that `NavRail`'s first tile
 * (`MediaRail.ets`'s own header comment: this wiring is "the composing
 * screen's job", since `MediaRail` itself has no attribute-chain access to
 * whatever `itemBuilder` renders).
 *
 * Touch: no hero at all (no touch-profile hero component exists anywhere in
 * `design/components/` -- `FeatureCopy.ets`/`Stage.ets` are both explicitly
 * TV-profile-only per their own header comments) -- just every non-empty
 * rail stacked in a `Scroll`, with `design/components/NavPill.ets` floating
 * at the bottom as a `Stack` sibling, always visible, rails scrolling
 * underneath it (brief 9's own words for this exact split).
 *
 * Nothing in this file imports `net/` or `auth/` (brief section 3.1,
 * validator-enforced).
 */

import { image } from '@kit.ImageKit';

import { activeColors, toResourceColor } from '../design/Theme';
import type { ThemeModeSetting } from '../design/Theme';
import { tv, TvGeometry, TouchGeometry } from '../design/Metrics';
import { Spacing, Radii } from '../core/Tokens';

import { Stage } from '../design/components/Stage';
import { MediaRail } from '../design/components/MediaRail';
import type { MediaRailItem } from '../design/components/MediaRail';
import { NavRail } from '../design/components/NavRail';
import type { NavRailItem } from '../design/components/NavRail';
import { NavPill } from '../design/components/NavPill';
import type { NavPillItem } from '../design/components/NavPill';
import { PosterCard } from '../design/components/PosterCard';
import { AsyncState, AsyncStateKind } from '../design/components/AsyncState';

import {
  getContinueWatching,
  getCatalog,
  getCatalogKinds,
} from '../data/CatalogRepository';
import type { ContinueWatchingEntry } from '../data/CatalogRepository';
import {
  fetchWorkArtworkByPriority,
  LANDSCAPE_ARTWORK_PRIORITY,
  HERO_ARTWORK_PRIORITY,
} from '../data/ArtworkRepository';

import type { DeviceProfile } from '../core/DeviceProfile';
import type { WorkKind } from '../core/Types/Catalog';
import type { Work } from '../core/Types/Work';

import { ROUTES } from '../navigation/Routes';
import type { DetailRouteParams, LibraryRouteParams } from '../navigation/Routes';
import { normaliseResumeMs } from '../core/EndOfPlayback.ts';
import { getNavStack, pushRoute, replaceRoute } from '../navigation/NavStack';

import { logWarn } from '../util/Log';

const LOG_TAG: string = 'Home';

/** Brief 9, Slice 6: "?kind=movie&sort=recent&limit=12&offset=0 ... then
 * both again at offset=12". */
const RAIL_LIMIT: number = 12;
const RAIL_OFFSET_NEW: number = 0;
const RAIL_OFFSET_MORE: number = 12;

/** Brief 4.8: `getCatalog`'s `sort` field is a plain `string`, `"recent"` is
 * one of its three documented values. */
const SORT_RECENT: string = 'recent';

/** Used when every rail is empty AND `getCatalogKinds()` itself failed (or
 * reported no kinds at all) -- a defensive, documented fallback so the
 * `Library` route this page bounces to always has SOME `kind` to open on. */
const DEFAULT_LIBRARY_FALLBACK_KIND: string = 'movie';

/** The nav item id for "this page" -- also the `NavRailItem`/`NavPillItem`
 * always prepended ahead of every kind-derived tile, so a user can always
 * get back to Home from the nav even when the kinds fetch fails. */
const HOME_NAV_ID: string = 'home';

/** Discriminants for "which rail rendered first" -- see `topRailFocusUpId`'s
 * wiring below. Plain string constants rather than an enum: `HomeCardItem`
 * only needs to compare them for equality, never switch exhaustively. */
const TOP_RAIL_CONTINUE_WATCHING: string = 'continueWatching';
const TOP_RAIL_NEW_MOVIES: string = 'newMovies';
const TOP_RAIL_NEW_SERIES: string = 'newSeries';
const TOP_RAIL_MORE_MOVIES: string = 'moreMovies';
const TOP_RAIL_MORE_SERIES: string = 'moreSeries';

/** Brief 5.4's "Touch profile sizes" for a home-rail card's title/subtitle
 * (12/10) -- `design/components/PosterCard.ets`'s own header comment names
 * these as the documented touch override, matching `pages/DesignGallery.ets`'s
 * `touchRailItem` demo exactly. */
const TOUCH_CARD_TITLE_FONT_SIZE: number = 12;
const TOUCH_CARD_SUBTITLE_FONT_SIZE: number = 10;

/** `TouchGeometryTokens` has no dedicated rail-to-rail spacing field (only
 * `railItemGap`, the gap BETWEEN cards inside one rail) -- a reasoned,
 * documented default rather than a brief literal, the same "reuse a token
 * where one is reasonably close" instinct `pages/Library.ets`'s own
 * `TOUCH_GRID_GAP_VP` already follows for an analogous gap brief 5.10 does
 * not name. */
const TOUCH_RAIL_GAP: number = Spacing.xl;

/** Extra bottom clearance under the touch rails column so the last rail's
 * cards are never obscured by the floating `NavPill` (brief 9: "rails
 * scrolling underneath it"). Derived from `NavPill`'s own footprint --
 * `pages/DesignGallery.ets`'s `NavPill` demo constraint uses the identical
 * `navItemHeight + navPaddingV * 2` base -- plus a further `Spacing.xxl` of
 * breathing room, since this is clearance for SCROLLED-PAST content, not a
 * tight bounding box. */
const TOUCH_BOTTOM_NAV_CLEARANCE: number =
  TouchGeometry.navItemHeight + TouchGeometry.navPaddingV * 2 + Spacing.xxl;

/** Only shipped icon asset today (`resources/base/media/playarr_logo.svg`)
 * -- the same documented placeholder choice `design/components/NavRail.ets`/
 * `NavPill.ets`'s own default items and `pages/DesignGallery.ets`'s gallery
 * nav demo already make, reused here for every real nav tile until per-kind
 * icon assets ship. */
const PLACEHOLDER_NAV_ICON: ResourceStr = $r('app.media.playarr_logo');

/**
 * This page's own local view-model shape for one rail/hero card (brief
 * section 3.2: "pages/. Presentational + a small local view-model per
 * page."). Satisfies `design/components/MediaRail.ets`'s `MediaRailItem`
 * (`{id: string}`) structurally, per that file's own header comment on why
 * a one-field interface lets any real catalogue item satisfy it with no
 * cast -- this file still casts explicitly (`item as HomeCardItem`) inside
 * `MediaRail`'s `itemBuilder` callback, since that callback's own declared
 * parameter type is the narrower `MediaRailItem`.
 */
interface HomeCardItem {
  id: string;
  kind: WorkKind;
  title: string;
  subtitle: string;
  genres: string[];
  releaseDate: string | null;
  /** The work's synopsis, `''` when the server has none (web shows it in the TV Home hero). */
  overview: string;
  /** Continue-watching fraction in `[0, 1]`, or `-1` to hide the progress
   * bar (`PosterCard.ets`'s own convention). */
  progress: number;
  /** `true` only for every card in whichever rail rendered FIRST -- the TV
   * item builder wires `.nextFocus({ up })` on exactly these cards. */
  applyTopRailFocus: boolean;
  /** `undefined` until `startArtworkLoading()`'s own fetch for this card
   * resolves; `PosterCard` renders a `Skeleton` placeholder meanwhile. */
  artwork: image.PixelMap | undefined;
}

/** A card's subtitle: the release year, or `''` (hidden by `PosterCard`)
 * when `releaseDate` is absent or malformed -- the same NaN-guard shape
 * `core/WatchProgressSort.ts#updatedAtMillis` already establishes for a
 * date string that might not parse. */
function releaseYearLabel(releaseDate: string | null): string {
  if (releaseDate === null) {
    return '';
  }
  const parsedMs = new Date(releaseDate).getTime();
  if (Number.isNaN(parsedMs)) {
    return '';
  }
  return String(new Date(releaseDate).getFullYear());
}

/** Web TV card caption: "Movie · 2014" (kind, then release year when known). */
function cardCaption(kind: WorkKind, releaseDate: string | null): string {
  const year = releaseYearLabel(releaseDate);
  return year.length > 0 ? `${workKindKicker(kind)} · ${year}` : workKindKicker(kind);
}

/** The hero kicker: the featured work's OWN kind, singular ("Movie",
 * "Series", ...) -- distinct from `catalogKindNavLabel` below, which names a
 * whole LIBRARY SECTION rather than one work. */
function workKindKicker(kind: WorkKind): string {
  if (kind === 'movie') {
    return 'Movie';
  }
  if (kind === 'series') {
    return 'Series';
  }
  if (kind === 'site') {
    return 'Site';
  }
  if (kind === 'artist') {
    return 'Artist';
  }
  return 'Author';
}

/** Nav tile label for a `getCatalogKinds()` kind -- names the library
 * section it opens (brief 9: "Nav destinations are driven by GET
 * /api/v1/catalog/kinds"), plural, distinct from `workKindKicker` above. */
/** Web's library nav order (`PRODUCT_NAV_GROUPS`): Series, Movies, Sites, Music; anything else after. */
const NAV_KIND_ORDER: WorkKind[] = ['series', 'movie', 'site', 'artist'];

function navKindRank(kind: WorkKind): number {
  const rank = NAV_KIND_ORDER.indexOf(kind);
  return rank < 0 ? NAV_KIND_ORDER.length : rank;
}

/** The web nav icon for a nav id (generated from web `NavIcons.tsx`); the logo only for kinds web has no icon for. */
function navIconFor(id: string): ResourceStr {
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

function catalogKindNavLabel(kind: WorkKind): string {
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

/** Builds one rail's card list from a plain catalogue `Work[]` (the new/more
 * movies/series rails). `isTopRail` is decided once, by the caller, for the
 * WHOLE rail -- see `HomeCardItem.applyTopRailFocus`'s own doc comment. */
function buildCardItems(works: Work[], isTopRail: boolean): HomeCardItem[] {
  const result: HomeCardItem[] = [];
  for (const work of works) {
    const item: HomeCardItem = {
      id: work.id,
      kind: work.kind,
      title: work.title,
      subtitle: cardCaption(work.kind, work.release_date),
      genres: work.genres,
      releaseDate: work.release_date,
      overview: work.overview ?? '',
      progress: -1,
      applyTopRailFocus: isTopRail,
      artwork: undefined,
    };
    result.push(item);
  }
  return result;
}

/** Builds the continue-watching rail's card list, computing each card's
 * progress fraction from its own `WatchProgress` row (brief 4.12). */
function buildContinueWatchingCardItems(entries: ContinueWatchingEntry[], isTopRail: boolean): HomeCardItem[] {
  const result: HomeCardItem[] = [];
  for (const entry of entries) {
    const durationMs = entry.progress.duration_ms;
    const fraction = durationMs > 0 ? entry.progress.position_ms / durationMs : 0;
    const item: HomeCardItem = {
      id: entry.work.id,
      kind: entry.work.kind,
      title: entry.work.title,
      subtitle: cardCaption(entry.work.kind, entry.work.release_date),
      genres: entry.work.genres,
      releaseDate: entry.work.release_date,
      overview: entry.work.overview ?? '',
      progress: fraction,
      applyTopRailFocus: isTopRail,
      artwork: undefined,
    };
    result.push(item);
  }
  return result;
}

/** Returns a copy of `item` with `artwork` replaced -- never mutates `item`
 * in place, so reassigning the array/field this came from always changes
 * the `@State` reference and is guaranteed to re-render, regardless of any
 * Map/array mutation-observability assumption. */
function patchOneCardArtwork(item: HomeCardItem, pixelMap: image.PixelMap): HomeCardItem {
  const patched: HomeCardItem = {
    id: item.id,
    kind: item.kind,
    title: item.title,
    subtitle: item.subtitle,
    genres: item.genres,
    overview: item.overview,
    releaseDate: item.releaseDate,
    progress: item.progress,
    applyTopRailFocus: item.applyTopRailFocus,
    artwork: pixelMap,
  };
  return patched;
}

/** Returns a fresh array with the one item whose `id === workId` patched via
 * `patchOneCardArtwork`, every other item untouched (same reference). */
function patchCardArtwork(items: HomeCardItem[], workId: string, pixelMap: image.PixelMap): HomeCardItem[] {
  const updated: HomeCardItem[] = [];
  for (const item of items) {
    if (item.id === workId) {
      updated.push(patchOneCardArtwork(item, pixelMap));
    } else {
      updated.push(item);
    }
  }
  return updated;
}

/** `NavRail`'s richer `{id, icon, label}` shape is this page's one canonical
 * nav-item list; `NavPill` only wants `{id, icon}`, derived here on demand
 * rather than kept as separate `@State`. */
function toNavPillItems(items: NavRailItem[]): NavPillItem[] {
  const result: NavPillItem[] = [];
  for (const item of items) {
    const pillItem: NavPillItem = { id: item.id, icon: item.icon };
    result.push(pillItem);
  }
  return result;
}

/** `Stage`'s `keyArt`, resolved from the hero card: the fetched artwork once
 * it resolves, otherwise `Stage`'s own documented placeholder default --
 * computed here, rather than left to `Stage`'s own default parameter, so
 * this page can always pass an explicit, definite value (`Stage.keyArt` is
 * not itself typed to accept `undefined`). */
function heroKeyArtFor(hero: HomeCardItem | undefined): ResourceStr | image.PixelMap {
  if (hero !== undefined && hero.artwork !== undefined) {
    return hero.artwork;
  }
  return '';
}

function heroKickerFor(hero: HomeCardItem | undefined): string {
  if (hero === undefined) {
    return '';
  }
  return hero.genres.length > 0 ? `${workKindKicker(hero.kind)} · ${hero.genres[0]}` : workKindKicker(hero.kind);
}

function heroTitleFor(hero: HomeCardItem | undefined): string {
  if (hero === undefined) {
    return '';
  }
  return hero.title;
}

/** Web's TV Home meta line is the runtime; list works carry no runtime, so the release year stands in. */
function heroMetaLinesFor(hero: HomeCardItem | undefined): string[] {
  if (hero === undefined) {
    return [];
  }
  const year = releaseYearLabel(hero.releaseDate);
  return year.length > 0 ? [year] : [];
}

@Component
export struct Home {
  @State private loading: boolean = true;
  @State private showError: boolean = false;
  @State private errorMessage: string = '';

  @State private continueWatchingItems: HomeCardItem[] = [];
  @State private newMovieItems: HomeCardItem[] = [];
  @State private newSeriesItems: HomeCardItem[] = [];
  @State private moreMovieItems: HomeCardItem[] = [];
  @State private moreSeriesItems: HomeCardItem[] = [];

  @State private hero: HomeCardItem | undefined = undefined;
  /** Only non-null when `this.hero` came from continue-watching -- see this
   * file's header comment on the hero play button's resume-vs-detail split. */
  @State private heroResumeMediaFileId: string | null = null;
  @State private heroResumeStartPositionMs: number = 0;

  /** `NavRail`/`NavPill`'s shared item list, driven by `getCatalogKinds()`
   * (brief 9), never hard-coded. */
  @State private navItems: NavRailItem[] = [];
  /** `'<id>-nav-tile'` for `navItems[0]` once populated, or `''` before that
   * -- see `NavRail.ets`'s own header comment on this exact wiring contract. */
  @State private topRailFocusUpId: string = '';

  // Tracked purely to force a re-render on theme / device-profile / TV-scale
  // change; the actual values always go through design/Theme.ets's and
  // design/Metrics.ets's own resolvers below (see those files' own header
  // comments, and pages/Library.ets's/pages/DesignGallery.ets's identical
  // fields, for this exact pattern).
  @StorageProp('colorMode') private sysColorMode: ColorMode = ColorMode.LIGHT;
  @StorageProp('themeModeSetting') private themeSetting: ThemeModeSetting = 'system';
  @StorageProp('deviceProfile') private deviceProfile: DeviceProfile | undefined = undefined;
  @StorageProp('tvScaleFactor') private trackedTvScale: number = 1;

  aboutToAppear(): void {
    this.load();
  }

  private async load(): Promise<void> {
    this.loading = true;
    this.showError = false;
    this.errorMessage = '';

    // Every call below is invoked (and its Promise captured) before any of
    // them is awaited, so all six requests are already in flight together --
    // see this file's own header comment and brief risk R14.
    const continueWatchingPromise = getContinueWatching();
    const newMoviesPromise = getCatalog({ kind: 'movie', sort: SORT_RECENT, limit: RAIL_LIMIT, offset: RAIL_OFFSET_NEW });
    const newSeriesPromise = getCatalog({ kind: 'series', sort: SORT_RECENT, limit: RAIL_LIMIT, offset: RAIL_OFFSET_NEW });
    const moreMoviesPromise = getCatalog({ kind: 'movie', sort: SORT_RECENT, limit: RAIL_LIMIT, offset: RAIL_OFFSET_MORE });
    const moreSeriesPromise = getCatalog({ kind: 'series', sort: SORT_RECENT, limit: RAIL_LIMIT, offset: RAIL_OFFSET_MORE });
    const kindsPromise = getCatalogKinds();

    const continueWatchingResult = await continueWatchingPromise;
    const newMoviesResult = await newMoviesPromise;
    const newSeriesResult = await newSeriesPromise;
    const moreMoviesResult = await moreMoviesPromise;
    const moreSeriesResult = await moreSeriesPromise;
    const kindsResult = await kindsPromise;

    // A genuine connectivity failure across every rail-shaped call -- see
    // this file's header comment on why this is a distinct, deliberate
    // ADDITION beyond the plain "empty rails fall back to Library" rule.
    // Checked as one compound condition (not stored in an intermediate
    // boolean first) so TypeScript keeps `continueWatchingResult` narrowed
    // to its network-failure shape for the `.message` read just below.
    if (
      continueWatchingResult.kind === 'network_failure' &&
      newMoviesResult.kind === 'network_failure' &&
      newSeriesResult.kind === 'network_failure' &&
      moreMoviesResult.kind === 'network_failure' &&
      moreSeriesResult.kind === 'network_failure'
    ) {
      logWarn(LOG_TAG, 'every Home rail fetch failed: ' + continueWatchingResult.message);
      this.loading = false;
      this.showError = true;
      this.errorMessage = continueWatchingResult.message;
      return;
    }

    const continueWatchingEntries: ContinueWatchingEntry[] =
      continueWatchingResult.kind === 'ok' ? continueWatchingResult.value : [];
    const newMovieWorks: Work[] = newMoviesResult.kind === 'ok' ? newMoviesResult.value.items : [];
    const newSeriesWorks: Work[] = newSeriesResult.kind === 'ok' ? newSeriesResult.value.items : [];
    const moreMovieWorks: Work[] = moreMoviesResult.kind === 'ok' ? moreMoviesResult.value.items : [];
    const moreSeriesWorks: Work[] = moreSeriesResult.kind === 'ok' ? moreSeriesResult.value.items : [];

    const navRailItems: NavRailItem[] = [{ id: HOME_NAV_ID, icon: navIconFor(HOME_NAV_ID), label: 'Home' }];
    if (kindsResult.kind === 'ok') {
      const kinds: WorkKind[] = kindsResult.value.slice();
      kinds.sort((a: WorkKind, b: WorkKind): number => navKindRank(a) - navKindRank(b));
      for (const kind of kinds) {
        navRailItems.push({ id: kind, icon: navIconFor(kind), label: catalogKindNavLabel(kind) });
      }
    }
    this.navItems = navRailItems;
    const firstNavItem = navRailItems[0];
    this.topRailFocusUpId = firstNavItem !== undefined ? `${firstNavItem.id}-nav-tile` : '';

    const totalCount =
      continueWatchingEntries.length +
      newMovieWorks.length +
      newSeriesWorks.length +
      moreMovieWorks.length +
      moreSeriesWorks.length;

    if (totalCount === 0) {
      // Brief 9: "If every rail comes back empty, fall back to the Library
      // route rather than showing a dead page."
      let fallbackKind: string = DEFAULT_LIBRARY_FALLBACK_KIND;
      if (kindsResult.kind === 'ok') {
        const firstKind = kindsResult.value[0];
        if (firstKind !== undefined) {
          fallbackKind = firstKind;
        }
      }
      const libraryParams: LibraryRouteParams = { kind: fallbackKind };
      replaceRoute(getNavStack(), ROUTES.Library, libraryParams);
      return;
    }

    let topRailKey: string = '';
    if (continueWatchingEntries.length > 0) {
      topRailKey = TOP_RAIL_CONTINUE_WATCHING;
    } else if (newMovieWorks.length > 0) {
      topRailKey = TOP_RAIL_NEW_MOVIES;
    } else if (newSeriesWorks.length > 0) {
      topRailKey = TOP_RAIL_NEW_SERIES;
    } else if (moreMovieWorks.length > 0) {
      topRailKey = TOP_RAIL_MORE_MOVIES;
    } else if (moreSeriesWorks.length > 0) {
      topRailKey = TOP_RAIL_MORE_SERIES;
    }

    this.continueWatchingItems = buildContinueWatchingCardItems(
      continueWatchingEntries,
      topRailKey === TOP_RAIL_CONTINUE_WATCHING
    );
    this.newMovieItems = buildCardItems(newMovieWorks, topRailKey === TOP_RAIL_NEW_MOVIES);
    this.newSeriesItems = buildCardItems(newSeriesWorks, topRailKey === TOP_RAIL_NEW_SERIES);
    this.moreMovieItems = buildCardItems(moreMovieWorks, topRailKey === TOP_RAIL_MORE_MOVIES);
    this.moreSeriesItems = buildCardItems(moreSeriesWorks, topRailKey === TOP_RAIL_MORE_SERIES);

    this.hero =
      this.continueWatchingItems[0] ??
      this.newMovieItems[0] ??
      this.newSeriesItems[0] ??
      this.moreMovieItems[0] ??
      this.moreSeriesItems[0];

    if (continueWatchingEntries.length > 0) {
      const firstEntry = continueWatchingEntries[0];
      if (firstEntry !== undefined) {
        this.heroResumeMediaFileId = firstEntry.progress.media_file_id;
        this.heroResumeStartPositionMs = normaliseResumeMs(
          firstEntry.progress.position_ms,
          firstEntry.progress.duration_ms
        );
      }
    } else {
      this.heroResumeMediaFileId = null;
      this.heroResumeStartPositionMs = 0;
    }

    this.loading = false;
    this.showError = false;

    this.startArtworkLoading();
  }

  /** Fires every card's (and the hero's) artwork fetch concurrently, without
   * awaiting any of them here -- each one patches its own `HomeCardItem`
   * (never the others) the moment it resolves. See this file's header
   * comment. */
  private startArtworkLoading(): void {
    const hero = this.hero;
    if (hero !== undefined) {
      this.loadHeroArtwork(hero.id);
    }
    this.loadRailArtwork(
      (): HomeCardItem[] => this.continueWatchingItems,
      (items: HomeCardItem[]): void => {
        this.continueWatchingItems = items;
      }
    );
    this.loadRailArtwork(
      (): HomeCardItem[] => this.newMovieItems,
      (items: HomeCardItem[]): void => {
        this.newMovieItems = items;
      }
    );
    this.loadRailArtwork(
      (): HomeCardItem[] => this.newSeriesItems,
      (items: HomeCardItem[]): void => {
        this.newSeriesItems = items;
      }
    );
    this.loadRailArtwork(
      (): HomeCardItem[] => this.moreMovieItems,
      (items: HomeCardItem[]): void => {
        this.moreMovieItems = items;
      }
    );
    this.loadRailArtwork(
      (): HomeCardItem[] => this.moreSeriesItems,
      (items: HomeCardItem[]): void => {
        this.moreSeriesItems = items;
      }
    );
  }

  /** Kicks off one concurrent fetch per item currently in `getItems()`, each
   * patching (via `setItems`) whichever array is CURRENT at the moment IT
   * resolves -- never a stale snapshot, since `getOneCardArtwork` re-reads
   * `getItems()` fresh inside its own (single, synchronous-until-`await`)
   * continuation. */
  private loadRailArtwork(getItems: () => HomeCardItem[], setItems: (items: HomeCardItem[]) => void): void {
    const items = getItems();
    for (const item of items) {
      this.loadOneCardArtwork(item.id, getItems, setItems);
    }
  }

  private async loadOneCardArtwork(
    workId: string,
    getItems: () => HomeCardItem[],
    setItems: (items: HomeCardItem[]) => void
  ): Promise<void> {
    const result = await fetchWorkArtworkByPriority(workId, LANDSCAPE_ARTWORK_PRIORITY);
    if (result.kind === 'ok') {
      setItems(patchCardArtwork(getItems(), workId, result.value));
    }
    // A failure (including the normal "no artwork of any priority kind" 404)
    // is left alone -- PosterCard already renders a Skeleton placeholder
    // whenever a card's `artwork` stays `undefined`.
  }

  private async loadHeroArtwork(workId: string): Promise<void> {
    const result = await fetchWorkArtworkByPriority(workId, HERO_ARTWORK_PRIORITY);
    if (result.kind === 'ok') {
      const current = this.hero;
      if (current !== undefined && current.id === workId) {
        this.hero = patchOneCardArtwork(current, result.value);
      }
    }
  }

  private openDetail(workId: string): void {
    const detailParams: DetailRouteParams = { workId: workId };
    pushRoute(getNavStack(), ROUTES.Detail, detailParams);
  }

  private handleNavSelect(id: string): void {
    if (id === HOME_NAV_ID) {
      return;
    }
    const libraryParams: LibraryRouteParams = { kind: id };
    pushRoute(getNavStack(), ROUTES.Library, libraryParams);
  }

  /** TV-profile card content: `PosterCard` sized from its own TV default
   * (brief 5.10's home-rail landscape width). Wires `.nextFocus({ up })` on
   * every card of whichever rail rendered first -- see
   * `HomeCardItem.applyTopRailFocus`'s own doc comment and this file's header
   * comment. Duplicating the `PosterCard({...})` call across the `if`/`else`
   * is unavoidable: ArkUI's declarative attribute chaining has no
   * conditional form, only a conditional CHOICE of which chain to render
   * (the same constraint `design/components/PosterCard.ets`'s own
   * `if (this.artwork !== undefined)` branch works within, one level up). */
  @Builder
  private tvCardItemBuilder(item: MediaRailItem, index: number, activeRailFactor: number): void {

    if (((item as HomeCardItem).applyTopRailFocus) && this.topRailFocusUpId.length > 0) {
      PosterCard({
        variant: 'home',
        title: ((item as HomeCardItem).title),
        subtitle: ((item as HomeCardItem).subtitle),
        progress: ((item as HomeCardItem).progress),
        artwork: ((item as HomeCardItem).artwork),
        activeRailFactor: activeRailFactor,
        onSelect: ((): void => {
      this.openDetail(((item as HomeCardItem).id));
    }),
      })
        .nextFocus({ up: this.topRailFocusUpId })
    } else {
      PosterCard({
        variant: 'home',
        title: ((item as HomeCardItem).title),
        subtitle: ((item as HomeCardItem).subtitle),
        progress: ((item as HomeCardItem).progress),
        artwork: ((item as HomeCardItem).artwork),
        activeRailFactor: activeRailFactor,
        onSelect: ((): void => {
      this.openDetail(((item as HomeCardItem).id));
    }),
      })
    }
  }

  /** Touch-profile card content: explicit `TouchGeometry` sizing plus brief
   * 5.4's documented touch title/subtitle overrides, matching
   * `pages/DesignGallery.ets`'s own `touchRailItem` demo exactly. No
   * `.nextFocus()` wiring -- touch has no D-pad "Up escapes to the nav rail"
   * concept, `NavPill` is always visible instead (brief 9). */
  @Builder
  private touchCardItemBuilder(item: MediaRailItem, index: number, activeRailFactor: number): void {

    PosterCard({
      variant: 'home',
      title: (item as HomeCardItem).title,
      subtitle: (item as HomeCardItem).subtitle,
      progress: (item as HomeCardItem).progress,
      artwork: (item as HomeCardItem).artwork,
      cardWidth: TouchGeometry.homeRailCardWidthLandscape,
      cardHeight: (Math.round((TouchGeometry.homeRailCardWidthLandscape * 9) / 16)),
      artworkRadius: Radii.homeCardArtworkTouch,
      titleFontSize: TOUCH_CARD_TITLE_FONT_SIZE,
      subtitleFontSize: TOUCH_CARD_SUBTITLE_FONT_SIZE,
      activeRailFactor: activeRailFactor,
      onSelect: ((): void => {
      this.openDetail(((item as HomeCardItem).id));
    }),
    })
  }

  /** `Stage`'s `railsSlot`: every non-empty rail stacked vertically inside
   * the glass rail panel `Stage` already renders, spaced by
   * `TvGeometry.homeRailsColumnRowGap` -- see this file's header comment on
   * reconciling brief 5.9's wider `homeRailsColumn*` figures against
   * `Stage`'s own compact rail-panel geometry. */
  @Builder
  private tvRailsSlot(): void {

    Column({ space: tv(TvGeometry.homeRailsColumnRowGap) }) {
      if (this.continueWatchingItems.length > 0) {
        MediaRail({
          railId: 'home-continue-watching-tv',
          heading: 'Continue Watching',
          items: this.continueWatchingItems,
          itemBuilder: (item: MediaRailItem, index: number, activeRailFactor: number): void => {
            this.tvCardItemBuilder(item, index, activeRailFactor);
          },
        })
      }
      if (this.newMovieItems.length > 0) {
        MediaRail({
          railId: 'home-new-movies-tv',
          heading: 'New Movies',
          items: this.newMovieItems,
          itemBuilder: (item: MediaRailItem, index: number, activeRailFactor: number): void => {
            this.tvCardItemBuilder(item, index, activeRailFactor);
          },
        })
      }
      if (this.newSeriesItems.length > 0) {
        MediaRail({
          railId: 'home-new-series-tv',
          heading: 'New Series',
          items: this.newSeriesItems,
          itemBuilder: (item: MediaRailItem, index: number, activeRailFactor: number): void => {
            this.tvCardItemBuilder(item, index, activeRailFactor);
          },
        })
      }
      if (this.moreMovieItems.length > 0) {
        MediaRail({
          railId: 'home-more-movies-tv',
          heading: 'More Movies',
          items: this.moreMovieItems,
          itemBuilder: (item: MediaRailItem, index: number, activeRailFactor: number): void => {
            this.tvCardItemBuilder(item, index, activeRailFactor);
          },
        })
      }
      if (this.moreSeriesItems.length > 0) {
        MediaRail({
          railId: 'home-more-series-tv',
          heading: 'More Series',
          items: this.moreSeriesItems,
          itemBuilder: (item: MediaRailItem, index: number, activeRailFactor: number): void => {
            this.tvCardItemBuilder(item, index, activeRailFactor);
          },
        })
      }
    }
    .width('100%')
    .alignItems(HorizontalAlign.Start)
  }

  /** The touch-profile rails column, scrolled underneath the always-visible
   * `NavPill` (brief 9). */
  @Builder
  private touchRailsColumn(): void {

    Column({ space: TOUCH_RAIL_GAP }) {
      if (this.continueWatchingItems.length > 0) {
        MediaRail({
          railId: 'home-continue-watching-touch',
          heading: 'Continue Watching',
          items: this.continueWatchingItems,
          itemGap: TouchGeometry.railItemGap,
          headingSize: TouchGeometry.railHeadingSize,
          itemBuilder: (item: MediaRailItem, index: number, activeRailFactor: number): void => {
            this.touchCardItemBuilder(item, index, activeRailFactor);
          },
        })
      }
      if (this.newMovieItems.length > 0) {
        MediaRail({
          railId: 'home-new-movies-touch',
          heading: 'New Movies',
          items: this.newMovieItems,
          itemGap: TouchGeometry.railItemGap,
          headingSize: TouchGeometry.railHeadingSize,
          itemBuilder: (item: MediaRailItem, index: number, activeRailFactor: number): void => {
            this.touchCardItemBuilder(item, index, activeRailFactor);
          },
        })
      }
      if (this.newSeriesItems.length > 0) {
        MediaRail({
          railId: 'home-new-series-touch',
          heading: 'New Series',
          items: this.newSeriesItems,
          itemGap: TouchGeometry.railItemGap,
          headingSize: TouchGeometry.railHeadingSize,
          itemBuilder: (item: MediaRailItem, index: number, activeRailFactor: number): void => {
            this.touchCardItemBuilder(item, index, activeRailFactor);
          },
        })
      }
      if (this.moreMovieItems.length > 0) {
        MediaRail({
          railId: 'home-more-movies-touch',
          heading: 'More Movies',
          items: this.moreMovieItems,
          itemGap: TouchGeometry.railItemGap,
          headingSize: TouchGeometry.railHeadingSize,
          itemBuilder: (item: MediaRailItem, index: number, activeRailFactor: number): void => {
            this.touchCardItemBuilder(item, index, activeRailFactor);
          },
        })
      }
      if (this.moreSeriesItems.length > 0) {
        MediaRail({
          railId: 'home-more-series-touch',
          heading: 'More Series',
          items: this.moreSeriesItems,
          itemGap: TouchGeometry.railItemGap,
          headingSize: TouchGeometry.railHeadingSize,
          itemBuilder: (item: MediaRailItem, index: number, activeRailFactor: number): void => {
            this.touchCardItemBuilder(item, index, activeRailFactor);
          },
        })
      }
    }
    .width('100%')
    .alignItems(HorizontalAlign.Start)
    .padding({ top: Spacing.xl, bottom: TOUCH_BOTTOM_NAV_CLEARANCE, left: Spacing.md, right: Spacing.md })
  }

  /** TV: `Stage` (hero + rails) with `NavRail` as a sibling in one full-bleed
   * `Stack`, matching `pages/DesignGallery.ets`'s own "Stage + NavRail"
   * demo composition exactly. */
  @Builder
  private tvContent(): void {

    Stack() {
      Stage({
        keyArt: heroKeyArtFor(this.hero),
        kicker: heroKickerFor(this.hero),
        title: heroTitleFor(this.hero),
        metaLines: heroMetaLinesFor(this.hero),
        synopsis: this.hero !== undefined ? this.hero.overview : '',
        // Arrow wrapper keeps `this` = Home; a bare method reference runs with Stage as `this`.
        railsSlot: (): void => {
          this.tvRailsSlot();
        },
      })
      NavRail({
        items: this.navItems,
        selectedId: HOME_NAV_ID,
        onSelect: ((id: string): void => {
      this.handleNavSelect(id);
    }),
      })
    }
    .width('100%')
    .height('100%')
  }

  /** Touch: the scrollable rails column with `NavPill` floating at the
   * bottom, always visible, per brief 9's own words. */
  @Builder
  private touchContent(): void {

    Stack() {
      Scroll() {
        this.touchRailsColumn()
      }
      .width('100%')
      .height('100%')

      NavPill({
        items: toNavPillItems(this.navItems),
        selectedId: HOME_NAV_ID,
        onSelect: ((id: string): void => {
      this.handleNavSelect(id);
    }),
      })
    }
    .width('100%')
    .height('100%')
  }

  build() {

    NavDestination() {
      Stack() {
        if (this.loading) {
          AsyncState({ kind: AsyncStateKind.Loading })
        } else if (this.showError) {
          AsyncState({
            kind: AsyncStateKind.Error,
            message: this.errorMessage,
            retryLabel: 'Retry',
            retry: ((): void => {
      this.load();
    }),
          })
        } else if ((this.deviceProfile !== undefined && this.deviceProfile.metricsKey === 'tv')) {
          this.tvContent()
        } else {
          this.touchContent()
        }
      }
      .width('100%')
      .height('100%')
      .backgroundColor(toResourceColor(activeColors().bg))
    }
    .hideTitleBar(true)
  }
}

/**
 * Registered in `profile/router_map.json` as the `Home` route's
 * `buildFunction`, once the navigation-shell slice adds that row --
 * `pages/Library.ets`'s own header comment and `LibraryBuilder` establish
 * this exact "not yet wired, ready the moment it lands" posture; `Home`
 * carries no route parameters (`navigation/Routes.ets`'s own note), so
 * both builder parameters are unused, kept only to match the fixed
 * two-parameter shape `router_map.json` invokes every `buildFunction` with.
 */
@Builder
export function HomeBuilder(_name: string, _param: Object): void {
  Home()
}
