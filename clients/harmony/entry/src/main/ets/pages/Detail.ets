/**
 * Work detail page (brief section 2.5: "Detail.ets -- Work detail: hero,
 * actions, seasons/episodes or albums/tracks, chapters, similar"; brief
 * section 9, Slice 6). Pushed onto the shared `NavPathStack` by name
 * (`navigation/Routes.ets`'s `ROUTES.Detail`) with a `DetailRouteParams`
 * (`{workId}`) -- see `DetailBuilder`, at the bottom of this file, for the
 * exact param-decoding entry point a `router_map.json` row (landed by
 * whichever slice finishes wiring the navigation shell) will target.
 *
 * ## Data flow
 *
 * `data/CatalogRepository.ets#getWorkDetail` fetches the `WorkDetail`; hero
 * art comes from `data/ArtworkRepository.ets#fetchWorkArtworkByPriority`
 * with `HERO_ARTWORK_PRIORITY` (`[backdrop, poster]`, brief 4.9). The
 * externally-tagged `children` union (brief 4.8) is decoded once, in
 * `buildRailsFromChildren`, into a UNIFORM `DetailRail[]` shape this file
 * renders identically regardless of which of the three object variants (or
 * the bare `"Movie"` string) actually came back:
 *
 * - `{"Series": SeasonDetail[]}` (also `WorkKind::Site`, which brief 4.8
 *   says "reuses the Series shape" -- this file never branches on
 *   `work.kind` to decide this, only on the SHAPE of `children`, so Site
 *   falls into this same path for free) -> one rail per season, episodes as
 *   rows.
 * - `{"Artist": AlbumDetail[]}` -> one rail per album, tracks as rows.
 * - `{"Author": BookDetail[]}` -> ONE rail (there is no second nesting level
 *   to split rails by the way seasons/albums have -- each `Book` is already
 *   a leaf/playable row on its own), holding every book as a row. This is
 *   the "simple single-item view" the brief's task framing groups with
 *   Movie: not literally one item, but each row needs no further expansion.
 * - the bare string `"Movie"` -> no rails at all (a Movie's only playable
 *   leaf is the work's own `media_file_id`, already surfaced by the primary
 *   play action).
 *
 * The primary play action resolves via `resolvePrimaryMediaFileId`: the
 * work's own `media_file_id` when present (a Movie's leaf), otherwise the
 * first row across the built rails, in order, that actually has a resolved
 * `media_file_id` (season 1 episode 1 / album 1 track 1 / book 1 -- skipping
 * any leading row that has not synced a file yet, brief 4.8's "be
 * additive-tolerant" extended to "a still-syncing leaf is not fatal, just
 * skip it").
 *
 * Similar titles come from `data/CatalogRepository.ets#getSimilarWorks`,
 * which already folds in the brief-4.8 "404 is normal, fall back to up to 3
 * genre queries" behaviour -- this file calls it exactly once, with no
 * knowledge of that fallback, and renders a trailing rail only when the
 * result is non-empty.
 *
 * ## Artwork
 *
 * Per-row artwork is intentionally modest in scope: an album's own cover
 * (`fetchAlbumArtworkByPriority`, `COVER_ARTWORK_PRIORITY`) is fetched ONCE
 * per album and reused for every track row inside it (there is no
 * per-track artwork endpoint at all, brief 4.9); an episode/book row tries
 * `fetchMediaThumbnail(mediaFileId, 0)` when it has a resolved
 * `media_file_id` -- exactly the "on-deck episode art" use
 * `data/ArtworkRepository.ets`'s own header comment documents that endpoint
 * for. Every fetch happens AFTER the rail/row skeletons are already on
 * screen (never blocking first paint), and each success rebuilds the
 * `@State` array it belongs to with a fresh reference (ArkTS `@State`
 * reactivity needs a new array/object identity, never an in-place mutation
 * -- the same discipline `data/ArtworkRepository.ets`'s own LRU cache uses
 * for its `removeCacheKey` rebuild).
 *
 * ## Layout
 *
 * TV: a full-bleed hero (`TvGeometry.detailBackdropLeftPct`) with a copy
 * column (`FeatureCopy` + primary play action, `detailCopyColumnStart`/
 * `detailCopyColumnTop`/`detailCopyColumnWidthRatio`) and a glass "browser"
 * panel of rails anchored to the trailing edge, vertically centred
 * (`detailBrowserWidthRatio`/`detailBrowserHeightRatio`/`detailBrowserEnd`,
 * brief 5.10's "browser 0.57 x 0.72 at CenterEnd, end 50" -- reproduced here
 * via ordinary flex end-alignment plus a trailing-edge padding rather than
 * absolute-position arithmetic against a percentage-sized panel, since the
 * latter needs the panel's own resolved pixel width up front and ArkUI has
 * no read-back for that inside `build()`). The two full-bleed scrims reuse
 * `Stage.ets`'s own vertical-vignette percentages (`keyArtScrimVerticalFade*`)
 * rather than inventing fresh ones -- brief 5.10's detail row gives only ONE
 * horizontal percentage, no vertical pair of its own, so reusing the
 * already-established Home vignette is a documented, deliberate
 * simplification, not a fabricated number.
 *
 * Touch: a fixed-height hero image with a `Scroll`ed column beneath it,
 * padded per `TouchGeometry.detailListTop`/`detailListBottom` and spaced per
 * `detailListSpacing` (brief 5.10's "LazyColumn top 245, h 16, bottom 112,
 * spacedBy 18" -- `detailListItemHeight` (16) has no single natural anchor
 * in this page's own content shape, since every real row here is a full
 * `PosterCard`, not a plain 16vp text line; it is left unused here rather
 * than forced onto content it was not measured for).
 *
 * ## Layer isolation (brief 3.1, validator-asserted)
 *
 * This file imports only `data/`, `design/`, `core/` and `navigation/` --
 * never `net/` or `auth/`. Every `data/` call already resolves to a
 * `Promise<ApiResult<T>>` (`net/ApiResult.ets`'s shape); this file narrows
 * the result by reading `.kind` directly off the inferred local (`'ok'` /
 * `'network_failure'` / `'http_failure'`) rather than importing
 * `isApiOk`/`ApiResult`/`ApiFailure` from `net/ApiResult.ets` itself, which
 * `checks/arkts.mjs`'s `pages/*.ets must not import from 'net/'` rule would
 * reject outright.
 */

import { image } from '@kit.ImageKit';

import { getWorkDetail, getSimilarWorks } from '../data/CatalogRepository';
import {
  fetchWorkArtworkByPriority,
  fetchAlbumArtworkByPriority,
  fetchMediaThumbnail,
  HERO_ARTWORK_PRIORITY,
  COVER_ARTWORK_PRIORITY,
} from '../data/ArtworkRepository';

import type {
  WorkDetail,
  WorkChildren,
  WorkChildrenSeries,
  WorkChildrenArtist,
  WorkChildrenAuthor,
  SeasonDetail,
  EpisodeDetail,
  AlbumDetail,
  TrackDetail,
  BookDetail,
  Season,
} from '../core/Types/WorkDetail';
import type { Work, Availability } from '../core/Types/Work';
import type { WorkKind } from '../core/Types/Catalog';

import { FeatureCopy } from '../design/components/FeatureCopy';
import { MediaRail } from '../design/components/MediaRail';
import type { MediaRailItem } from '../design/components/MediaRail';
import { PosterCard } from '../design/components/PosterCard';
import { AsyncState, AsyncStateKind } from '../design/components/AsyncState';
import { Skeleton } from '../design/components/Skeleton';

import { activeColors, toResourceColor, toResourceColorWithAlpha, resolvedThemeMode } from '../design/Theme';
import type { ThemeModeSetting } from '../design/Theme';
import { tv, isTvMetrics, TvGeometry, TouchGeometry } from '../design/Metrics';
import { Spacing, Radii } from '../core/Tokens';
import type { RgbaColor } from '../core/Tokens';
import type { DeviceProfile } from '../core/DeviceProfile';
import { buildSeriesQueue, buildAlbumQueue } from '../core/EndOfPlayback.ts';
import type { QueueItem } from '../core/EndOfPlayback.ts';

import { ROUTES } from '../navigation/Routes';
import type { DetailRouteParams, PlayerRouteParams } from '../navigation/Routes';
import { getNavStack, pushRoute } from '../navigation/NavStack';

// -- UI-only constants (not brief/Tokens.ts literals -- see design/components/
// AsyncState.ets's/Skeleton.ets's own header comments for this documented
// exception pattern) --------------------------------------------------------

const PLAY_BUTTON_HEIGHT_TV: number = 56;
const PLAY_BUTTON_HEIGHT_TOUCH: number = 48;
const PLAY_BUTTON_ICON_SIZE: number = 18;
const PLAY_BUTTON_LABEL_SIZE: number = 16;
const HERO_TOUCH_HEIGHT: number = 340;

/** Glass "browser" panel recipe -- brief 5.6 documents this exact glass
 * treatment for the rail panel; not a `core/Tokens.ts` field, matching
 * `design/components/Stage.ets`'s own identical constants (duplicated here
 * rather than imported since they are private to that file). */
const RAIL_PANEL_BLUR_RADIUS: number = 30;
const RAIL_PANEL_SURFACE_OPACITY_LIGHT: number = 0.72;
const RAIL_PANEL_SURFACE_OPACITY_DARK: number = 0.76;
const RAIL_PANEL_HAIRLINE_ALPHA: number = 0.22;
const HAIRLINE_WHITE: RgbaColor = { r: 255, g: 255, b: 255, a: 1 };

/** Fraction (0-1) conversion for a literal CSS percentage field, matching
 * `design/components/Stage.ets`'s own identical private helper. */
function pct100(value: number): number {
  return value / 100;
}

// -- Row/rail view models ----------------------------------------------------

/**
 * One playable-or-navigable row inside a rail: an episode, a track, a book,
 * or a similar-title. Deliberately ONE shape for all four -- every one of
 * them renders as a `PosterCard` with a title/subtitle/artwork, and differs
 * only in what selecting it does (`mediaFileId` set -> jump straight to
 * Player; `similarWorkId` set -> push another Detail for that work). At
 * most one of the two is ever non-null for a given row.
 */
interface DetailRow {
  id: string;
  title: string;
  subtitle: string;
  artwork: image.PixelMap | undefined;
  mediaFileId: string | null;
  similarWorkId: string | null;
}

/** One season/album/books/similar rail: a heading plus its rows. */
interface DetailRail {
  id: string;
  heading: string;
  items: DetailRow[];
}

function kindLabel(kind: WorkKind): string {
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

function humanizeAvailability(availability: Availability): string {
  if (availability === 'available') {
    return 'Available';
  }
  if (availability === 'partially_available') {
    return 'Partially available';
  }
  if (availability === 'processing') {
    return 'Processing';
  }
  if (availability === 'pending') {
    return 'Pending';
  }
  if (availability === 'deleted') {
    return 'Deleted';
  }
  return 'Availability unknown';
}

function formatRuntimeLabel(ms: number | null): string {
  if (ms === null || ms <= 0) {
    return '';
  }
  const totalMinutes = Math.round(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours <= 0) {
    return minutes + 'm';
  }
  if (minutes <= 0) {
    return hours + 'h';
  }
  return hours + 'h ' + minutes + 'm';
}

function formatYearLabel(releaseDate: string | null): string {
  if (releaseDate === null || releaseDate.length < 4) {
    return '';
  }
  return releaseDate.slice(0, 4);
}

/** FeatureCopy's `metaLines`: a first line of "year - genre - runtime"
 * (whichever parts are present), then a second, muted line carrying the
 * work's cross-peer availability (brief 4.3/4.8). */
function buildMetaLines(detail: WorkDetail): string[] {
  const work = detail.work;
  const parts: string[] = [];

  const year = formatYearLabel(work.release_date);
  if (year.length > 0) {
    parts.push(year);
  }
  if (work.genres.length > 0) {
    parts.push(work.genres[0]);
  }
  const runtime = formatRuntimeLabel(detail.runtime_ms);
  if (runtime.length > 0) {
    parts.push(runtime);
  }

  const lines: string[] = [];
  if (parts.length > 0) {
    lines.push(parts.join(' - '));
  }
  lines.push(humanizeAvailability(work.availability));
  return lines;
}

function episodeMediaFileId(detail: EpisodeDetail): string | null {
  if (detail.media_file_id === undefined || detail.media_file_id === null) {
    return null;
  }
  return detail.media_file_id;
}

function buildEpisodeRow(detail: EpisodeDetail): DetailRow {
  const episode = detail.episode;
  let title = 'Episode ' + String(episode.episode_number);
  if (episode.title !== undefined && episode.title !== null && episode.title.length > 0) {
    title = episode.title;
  }
  const row: DetailRow = {
    id: episode.id,
    title: title,
    subtitle: 'Episode ' + String(episode.episode_number),
    artwork: undefined,
    mediaFileId: episodeMediaFileId(detail),
    similarWorkId: null,
  };
  return row;
}

function seasonHeading(season: Season): string {
  if (season.title !== undefined && season.title !== null && season.title.length > 0) {
    return season.title;
  }
  return 'Season ' + String(season.season_number);
}

function buildSeasonRail(detail: SeasonDetail): DetailRail {
  const items: DetailRow[] = [];
  for (const episodeDetail of detail.episodes) {
    items.push(buildEpisodeRow(episodeDetail));
  }
  const rail: DetailRail = {
    id: 'season-' + detail.season.id,
    heading: seasonHeading(detail.season),
    items: items,
  };
  return rail;
}

function buildSeasonRails(seasons: SeasonDetail[]): DetailRail[] {
  const rails: DetailRail[] = [];
  for (const season of seasons) {
    rails.push(buildSeasonRail(season));
  }
  return rails;
}

function trackMediaFileId(detail: TrackDetail): string | null {
  if (detail.media_file_id === undefined || detail.media_file_id === null) {
    return null;
  }
  return detail.media_file_id;
}

function buildTrackRow(detail: TrackDetail): DetailRow {
  const track = detail.track;
  const row: DetailRow = {
    id: track.id,
    title: track.title,
    subtitle: 'Track ' + String(track.track_number),
    artwork: undefined,
    mediaFileId: trackMediaFileId(detail),
    similarWorkId: null,
  };
  return row;
}

function buildAlbumRail(detail: AlbumDetail): DetailRail {
  const items: DetailRow[] = [];
  for (const trackDetail of detail.tracks) {
    items.push(buildTrackRow(trackDetail));
  }
  const rail: DetailRail = {
    id: 'album-' + detail.album.id,
    heading: detail.album.title,
    items: items,
  };
  return rail;
}

function buildAlbumRails(albums: AlbumDetail[]): DetailRail[] {
  const rails: DetailRail[] = [];
  for (const album of albums) {
    rails.push(buildAlbumRail(album));
  }
  return rails;
}

function bookMediaFileId(detail: BookDetail): string | null {
  if (detail.media_file_id === undefined || detail.media_file_id === null) {
    return null;
  }
  return detail.media_file_id;
}

function buildBookRow(detail: BookDetail): DetailRow {
  const book = detail.book;
  let subtitle = '';
  if (book.series_name !== undefined && book.series_name !== null && book.series_name.length > 0) {
    subtitle = book.series_name;
    if (book.series_position !== undefined && book.series_position !== null) {
      subtitle = subtitle + ' #' + String(book.series_position);
    }
  }
  const row: DetailRow = {
    id: book.id,
    title: book.title,
    subtitle: subtitle,
    artwork: undefined,
    mediaFileId: bookMediaFileId(detail),
    similarWorkId: null,
  };
  return row;
}

function buildBooksRail(books: BookDetail[]): DetailRail {
  const items: DetailRow[] = [];
  for (const book of books) {
    items.push(buildBookRow(book));
  }
  const rail: DetailRail = { id: 'books', heading: 'Books', items: items };
  return rail;
}

/**
 * Decodes the brief-4.8 externally-tagged `children` union into a uniform
 * `DetailRail[]` -- see this file's header comment for the exact shape
 * table. Every branch is a plain cast-then-field-check, never `Reflect`/`in`
 * (both awkward or banned for a union that includes a bare string variant),
 * matching `WorkDetail.ts`'s own doc comment on how to tell the variants
 * apart: try the string case first, then probe each object variant's own
 * named field.
 */
function buildRailsFromChildren(children: WorkChildren): DetailRail[] {
  if (typeof children === 'string') {
    return [];
  }

  const asSeries = children as WorkChildrenSeries;
  if (asSeries.Series !== undefined) {
    return buildSeasonRails(asSeries.Series);
  }

  const asArtist = children as WorkChildrenArtist;
  if (asArtist.Artist !== undefined) {
    return buildAlbumRails(asArtist.Artist);
  }

  const asAuthor = children as WorkChildrenAuthor;
  if (asAuthor.Author !== undefined) {
    return [buildBooksRail(asAuthor.Author)];
  }

  return [];
}

/** Walks every rail's rows, in order, returning the first resolved
 * `media_file_id` -- "season 1 episode 1" / "album 1 track 1" / "book 1",
 * skipping any row that has not synced a file yet. */
function firstPlayableFromRails(rails: DetailRail[]): string | null {
  for (const rail of rails) {
    for (const item of rail.items) {
      if (item.mediaFileId !== null) {
        return item.mediaFileId;
      }
    }
  }
  return null;
}

/** The primary play action's target: a Movie's own leaf when present,
 * otherwise the first playable row across the built rails. */
function resolvePrimaryMediaFileId(detail: WorkDetail, rails: DetailRail[]): string | null {
  if (detail.media_file_id !== null) {
    return detail.media_file_id;
  }
  return firstPlayableFromRails(rails);
}

function buildSimilarRail(works: Work[]): DetailRail {
  const items: DetailRow[] = [];
  for (const work of works) {
    const row: DetailRow = {
      id: work.id,
      title: work.title,
      subtitle: kindLabel(work.kind),
      artwork: undefined,
      mediaFileId: null,
      similarWorkId: work.id,
    };
    items.push(row);
  }
  const rail: DetailRail = { id: 'similar', heading: 'Similar Titles', items: items };
  return rail;
}

/** Rebuilds `rail` with `rowId`'s row's `artwork` replaced -- every other
 * row is returned unchanged. Used both for a flat similar-titles rail and,
 * via `applyRowArtworkAcrossRails` below, for a specific row somewhere
 * inside a list of season/book rails. Never mutates `rail`/its rows in
 * place -- ArkTS `@State` reactivity needs a fresh reference, matching
 * `data/ArtworkRepository.ets`'s own rebuild-rather-than-mutate cache
 * eviction discipline. */
function applyRowArtworkInRail(rail: DetailRail, rowId: string, artwork: image.PixelMap): DetailRail {
  const items: DetailRow[] = [];
  for (const item of rail.items) {
    if (item.id === rowId) {
      const next: DetailRow = {
        id: item.id,
        title: item.title,
        subtitle: item.subtitle,
        artwork: artwork,
        mediaFileId: item.mediaFileId,
        similarWorkId: item.similarWorkId,
      };
      items.push(next);
    } else {
      items.push(item);
    }
  }
  const next: DetailRail = { id: rail.id, heading: rail.heading, items: items };
  return next;
}

function applyRowArtworkAcrossRails(rails: DetailRail[], rowId: string, artwork: image.PixelMap): DetailRail[] {
  const updated: DetailRail[] = [];
  for (const rail of rails) {
    updated.push(applyRowArtworkInRail(rail, rowId, artwork));
  }
  return updated;
}

/** Applies ONE artwork to EVERY row inside the rail identified by `railId`
 * -- used for an album, whose cover is fetched once and shown on every
 * track row (brief 4.9: there is no per-track artwork endpoint). */
function applyAlbumArtwork(rails: DetailRail[], railId: string, artwork: image.PixelMap): DetailRail[] {
  const updated: DetailRail[] = [];
  for (const rail of rails) {
    if (rail.id !== railId) {
      updated.push(rail);
      continue;
    }
    const items: DetailRow[] = [];
    for (const item of rail.items) {
      const next: DetailRow = {
        id: item.id,
        title: item.title,
        subtitle: item.subtitle,
        artwork: artwork,
        mediaFileId: item.mediaFileId,
        similarWorkId: item.similarWorkId,
      };
      items.push(next);
    }
    updated.push({ id: rail.id, heading: rail.heading, items: items });
  }
  return updated;
}

@Component
struct Detail {
  @Prop workId: string = '';

  // Tracked purely to force a re-render on theme / device-profile / TV-scale
  // change; the actual values always go through design/Theme.ets's and
  // design/Metrics.ets's own resolver functions (see those files' header
  // comments for this exact pattern, already used by every component in
  // this design system).
  @StorageProp('colorMode') private sysColorMode: ColorMode = ColorMode.LIGHT;
  @StorageProp('themeModeSetting') private themeSetting: ThemeModeSetting = 'system';
  @StorageProp('deviceProfile') private trackedDeviceProfile: DeviceProfile | undefined = undefined;
  @StorageProp('tvScaleFactor') private trackedTvScaleFactor: number = 1;

  @State private detail: WorkDetail | null = null;
  @State private loadFailed: boolean = false;
  @State private errorMessage: string = '';
  @State private heroArtwork: image.PixelMap | undefined = undefined;
  @State private rails: DetailRail[] = [];
  @State private similarRail: DetailRail | null = null;
  @State private primaryMediaFileId: string | null = null;

  aboutToAppear(): void {
    this.loadDetail();
  }

  private async loadDetail(): Promise<void> {
    this.detail = null;
    this.loadFailed = false;
    this.errorMessage = '';
    this.heroArtwork = undefined;
    this.rails = [];
    this.similarRail = null;
    this.primaryMediaFileId = null;

    const workId = this.workId;
    const detailResult = await getWorkDetail(workId);
    if (detailResult.kind !== 'ok') {
      this.loadFailed = true;
      if (detailResult.kind === 'network_failure') {
        this.errorMessage = detailResult.message;
      } else if (detailResult.envelope.kind === 'general') {
        this.errorMessage = detailResult.envelope.message;
      } else {
        this.errorMessage = 'Something went wrong loading this title.';
      }
      return;
    }

    const detail = detailResult.value;
    this.detail = detail;

    const rails = buildRailsFromChildren(detail.children);
    this.rails = rails;
    this.primaryMediaFileId = resolvePrimaryMediaFileId(detail, rails);

    this.loadHeroArtwork(detail.work.id);
    this.hydrateRailArtwork();
    this.loadSimilar(detail.work);
  }

  private async loadHeroArtwork(workId: string): Promise<void> {
    const result = await fetchWorkArtworkByPriority(workId, HERO_ARTWORK_PRIORITY);
    if (result.kind === 'ok') {
      this.heroArtwork = result.value;
    }
  }

  /** Fires once per rail: an album rail's cover is fetched once and applied
   * to every track row at once; every other rail (season/books) hydrates
   * its rows individually via `fetchMediaThumbnail`, skipping any row whose
   * `media_file_id` has not resolved yet. */
  private async hydrateRailArtwork(): Promise<void> {
    const detail = this.detail;
    const artistWorkId = detail !== null ? detail.work.id : '';
    const rails = this.rails;

    for (const rail of rails) {
      if (rail.id.startsWith('album-')) {
        const albumId = rail.id.slice('album-'.length);
        const albumArt = await fetchAlbumArtworkByPriority(artistWorkId, albumId, COVER_ARTWORK_PRIORITY);
        if (albumArt.kind === 'ok') {
          this.rails = applyAlbumArtwork(this.rails, rail.id, albumArt.value);
        }
        continue;
      }

      for (const item of rail.items) {
        if (item.mediaFileId === null) {
          continue;
        }
        const thumb = await fetchMediaThumbnail(item.mediaFileId, 0);
        if (thumb.kind === 'ok') {
          this.rails = applyRowArtworkAcrossRails(this.rails, item.id, thumb.value);
        }
      }
    }
  }

  /** Brief 4.8: a 404 here is normal and already handled inside
   * `getSimilarWorks` itself (the genre-query fallback) -- this method only
   * ever sees the final, already-reconciled result. */
  private async loadSimilar(work: Work): Promise<void> {
    const result = await getSimilarWorks(work);
    if (result.kind !== 'ok' || result.value.length === 0) {
      return;
    }
    this.similarRail = buildSimilarRail(result.value);
    this.hydrateSimilarArtwork();
  }

  private async hydrateSimilarArtwork(): Promise<void> {
    const rail = this.similarRail;
    if (rail === null) {
      return;
    }
    for (const item of rail.items) {
      if (item.similarWorkId === null) {
        continue;
      }
      const result = await fetchWorkArtworkByPriority(item.similarWorkId, COVER_ARTWORK_PRIORITY);
      if (result.kind === 'ok') {
        const current = this.similarRail;
        if (current !== null) {
          this.similarRail = applyRowArtworkInRail(current, item.id, result.value);
        }
      }
    }
  }

  /** The primary play action: jumps straight to Player with the resolved
   * `media_file_id` plus this page's own `workId` (`NavStack.ets`'s
   * documented `PlayerRouteParams` shape). A no-op while nothing is
   * playable yet (still loading, or no synced leaf anywhere). */
  private playPrimary(): void {
    const mediaFileId = this.primaryMediaFileId;
    if (mediaFileId === null) {
      return;
    }
    const currentWorkId = this.workId;
    const stack = getNavStack();
    const upNext = this.upNextQueueAfter(mediaFileId);
    const params: PlayerRouteParams = {
      mediaFileId: mediaFileId,
      workId: currentWorkId,
      queue: upNext,
    };
    pushRoute(stack, ROUTES.Player, params);
  }

  /** Playable episodes after `mediaFileId` (series only; empty for movies,
   * albums and books), handed to the Player as its up-next queue. */
  private upNextQueueAfter(mediaFileId: string): QueueItem[] {
    const detail = this.detail;
    if (detail === null || typeof detail.children === 'string') {
      return [];
    }
    const asSeries = detail.children as WorkChildrenSeries;
    if (asSeries.Series !== undefined) {
      return buildSeriesQueue(detail.work.id, detail.work.title, asSeries.Series, mediaFileId);
    }
    const asArtist = detail.children as WorkChildrenArtist;
    if (asArtist.Artist !== undefined) {
      return buildAlbumQueue(detail.work.id, asArtist.Artist, mediaFileId);
    }
    return [];
  }

  /** Dispatches a row selection: a playable leaf jumps to Player, a
   * similar-title row pushes another Detail for that work. A row with
   * neither (an episode/track/book that has not synced a file yet) is a
   * no-op. */
  private selectRow(row: DetailRow): void {
    const stack = getNavStack();
    if (row.mediaFileId !== null) {
      const currentWorkId = this.workId;
      const upNext = this.upNextQueueAfter(row.mediaFileId);
      const params: PlayerRouteParams = {
        mediaFileId: row.mediaFileId,
        workId: currentWorkId,
        queue: upNext,
      };
      pushRoute(stack, ROUTES.Player, params);
      return;
    }
    if (row.similarWorkId !== null) {
      const params: DetailRouteParams = { workId: row.similarWorkId };
      pushRoute(stack, ROUTES.Detail, params);
    }
  }

  private railPanelSurfaceOpacity(): number {
    if (resolvedThemeMode() === 'dark') {
      return RAIL_PANEL_SURFACE_OPACITY_DARK;
    }
    return RAIL_PANEL_SURFACE_OPACITY_LIGHT;
  }

  /** Episode/track/book row content -- brief 5.8's "title/episode" focus
   * delta and shadow pair (`PosterCard`'s `'titleEpisode'` variant). */
  @Builder
  private rowItem(item: MediaRailItem, index: number, activeRailFactor: number): void {
    if (isTvMetrics()) {
      PosterCard({
        variant: 'titleEpisode',
        title: (item as DetailRow).title,
        subtitle: (item as DetailRow).subtitle,
        artwork: (item as DetailRow).artwork,
        cardWidth: tv(TvGeometry.railPanelCardWidth),
        cardHeight: Math.round((tv(TvGeometry.railPanelCardWidth) * 9) / 16),
        activeRailFactor: activeRailFactor,
        onSelect: () => {
          this.selectRow((item as DetailRow));
        },
      })
    } else {
      PosterCard({
        variant: 'titleEpisode',
        title: (item as DetailRow).title,
        subtitle: (item as DetailRow).subtitle,
        artwork: (item as DetailRow).artwork,
        cardWidth: TouchGeometry.homeRailCardWidthLandscape,
        cardHeight: Math.round((TouchGeometry.homeRailCardWidthLandscape * 9) / 16),
        titleFontSize: 12,
        subtitleFontSize: 10,
        activeRailFactor: activeRailFactor,
        onSelect: () => {
          this.selectRow((item as DetailRow));
        },
      })
    }
  }

  /** Similar-title row content -- a cover (2:3) card, matching every other
   * work-poster placement in this design system (brief 4.9's
   * `COVER_ARTWORK_PRIORITY`). */
  @Builder
  private similarItem(item: MediaRailItem, index: number, activeRailFactor: number): void {
    if (isTvMetrics()) {
      PosterCard({
        variant: 'home',
        title: (item as DetailRow).title,
        subtitle: (item as DetailRow).subtitle,
        artwork: (item as DetailRow).artwork,
        cardWidth: tv(TvGeometry.homeRailCardWidthCover),
        cardHeight: Math.round((tv(TvGeometry.homeRailCardWidthCover) * 3) / 2),
        artworkRadius: Radii.homeCardArtworkTv,
        activeRailFactor: activeRailFactor,
        onSelect: () => {
          this.selectRow((item as DetailRow));
        },
      })
    } else {
      PosterCard({
        variant: 'home',
        title: (item as DetailRow).title,
        subtitle: (item as DetailRow).subtitle,
        artwork: (item as DetailRow).artwork,
        cardWidth: TouchGeometry.homeRailCardWidthCover,
        cardHeight: Math.round((TouchGeometry.homeRailCardWidthCover * 3) / 2),
        artworkRadius: Radii.homeCardArtworkTouch,
        titleFontSize: 12,
        subtitleFontSize: 10,
        activeRailFactor: activeRailFactor,
        onSelect: () => {
          this.selectRow((item as DetailRow));
        },
      })
    }
  }

  /** The primary play action: a simple pill (brief 5.8's "primary play
   * action" lift is reproduced via `FocusLift`-free plain opacity/scale
   * here, a deliberately lighter treatment than `Stage.ets`'s own home-hero
   * glass button -- this page's own play action is a labelled pill inside a
   * text copy column, not an icon-only circular affordance floating over
   * full-bleed key art, so re-deriving Stage's exact glass recipe would not
   * fit this different context). Disabled (dimmed, unfocusable) while
   * nothing is resolved to play yet. */
  @Builder
  private playButton(enabled: boolean, height: number): void {

    Row({ space: Spacing.sm }) {
      Text('▶')
        .fontSize(PLAY_BUTTON_ICON_SIZE)
        .fontColor(toResourceColor(activeColors().onAccent))
      Text((enabled ? 'Play' : 'Unavailable'))
        .fontSize(PLAY_BUTTON_LABEL_SIZE)
        .fontWeight(FontWeight.Bold)
        .fontColor(toResourceColor(activeColors().onAccent))
    }
    .height(height)
    .padding({ left: Spacing.lg, right: Spacing.lg })
    .borderRadius(Radii.pillFull)
    .justifyContent(FlexAlign.Center)
    .alignItems(VerticalAlign.Center)
    .backgroundColor((enabled ? toResourceColor(activeColors().accent) : toResourceColor(activeColors().inkMuted)))
    .opacity((enabled ? 1 : 0.6))
    .focusable(enabled)
    .onClick(() => {
      this.playPrimary();
    })
  }

  @Builder
  private railsColumn(): void {

    Column({ space: Spacing.xl }) {
      ForEach(
        this.rails,
        (rail: DetailRail) => {
          MediaRail({
            railId: rail.id,
            heading: rail.heading,
            itemGap: (isTvMetrics() ? tv(TvGeometry.railItemGapTitle) : TouchGeometry.railItemGap),
            headingSize: (isTvMetrics() ? tv(TvGeometry.railHeadingSize) : TouchGeometry.railHeadingSize),
            items: rail.items,
            itemBuilder: (item: MediaRailItem, index: number, activeRailFactor: number): void => {
              this.rowItem(item, index, activeRailFactor);
            },
          })
        },
        (rail: DetailRail): string => rail.id
      )

      if (this.similarRail !== null) {
        MediaRail({
          railId: this.similarRail.id,
          heading: this.similarRail.heading,
          headingSize: (isTvMetrics() ? tv(TvGeometry.railHeadingSize) : TouchGeometry.railHeadingSize),
          items: this.similarRail.items,
          itemBuilder: (item: MediaRailItem, index: number, activeRailFactor: number): void => {
            this.similarItem(item, index, activeRailFactor);
          },
        })
      }
    }
    .alignItems(HorizontalAlign.Start)
    .width('100%')
  }

  private synopsisText(): string {
    if (this.detail !== null && this.detail.work.overview !== null) {
      return this.detail.work.overview;
    }
    return '';
  }

  @Builder
  private tvLayout(): void {

    Stack() {
      if (this.heroArtwork !== undefined) {
        Image(this.heroArtwork)
          .width('100%')
          .height('100%')
          .objectFit(ImageFit.Cover)
          .draggable(false)
          .focusable(false)
      } else {
        Skeleton({ blockWidth: tv(1920), blockHeight: tv(1080), radius: 0 })
      }

      Row()
        .width('100%')
        .height('100%')
        .hitTestBehavior(HitTestMode.Transparent)
        .linearGradient({
          angle: 90,
          colors: [
            [toResourceColor(activeColors().surface), 0],
            [toResourceColorWithAlpha(activeColors().surface, 0), pct100(TvGeometry.detailBackdropLeftPct)],
          ],
        })

      Row()
        .width('100%')
        .height('100%')
        .hitTestBehavior(HitTestMode.Transparent)
        .linearGradient({
          angle: 0,
          colors: [
            [toResourceColor(activeColors().surface), 0],
            [toResourceColorWithAlpha(activeColors().surface, 0), pct100(TvGeometry.keyArtScrimVerticalFadeInPct)],
            [
              toResourceColorWithAlpha(activeColors().surface, 0),
              pct100(TvGeometry.keyArtScrimVerticalFadeOutStartPct),
            ],
            [toResourceColor(activeColors().surface), 1],
          ],
        })

      Column({ space: Spacing.lg }) {
        FeatureCopy({ kicker: (this.detail !== null ? kindLabel(this.detail.work.kind) : ''), title: (this.detail !== null ? this.detail.work.title : ''), metaLines: (this.detail !== null ? buildMetaLines(this.detail) : []), synopsis: this.synopsisText() })
        this.playButton(this.primaryMediaFileId !== null, tv(PLAY_BUTTON_HEIGHT_TV))
      }
      .width(`${TvGeometry.detailCopyColumnWidthRatio * 100}%`)
      .alignItems(HorizontalAlign.Start)
      .position({ x: tv(TvGeometry.detailCopyColumnStart), y: tv(TvGeometry.detailCopyColumnTop) })

      Row() {
        Scroll() {
          this.railsColumn()
        }
        .align(Alignment.Top)
        .width('100%')
        .height('100%')
        .padding(tv(TvGeometry.railPanelPadding))
        .borderRadius(Radii.railPanel)
        .clip(true)
        .backgroundColor(toResourceColorWithAlpha(activeColors().surfaceStrong, this.railPanelSurfaceOpacity()))
        .backdropBlur(tv(RAIL_PANEL_BLUR_RADIUS))
        .border({ width: tv(1), color: toResourceColorWithAlpha(HAIRLINE_WHITE, RAIL_PANEL_HAIRLINE_ALPHA) })
      }
      .width(`${TvGeometry.detailBrowserWidthRatio * 100}%`)
      .height(`${TvGeometry.detailBrowserHeightRatio * 100}%`)
      .justifyContent(FlexAlign.Center)
    }
    .width('100%')
    .height('100%')
    .alignContent(Alignment.TopEnd)
    .padding({ right: tv(TvGeometry.detailBrowserEnd), top: 0 })
    .backgroundColor(toResourceColor(activeColors().surface))
  }

  @Builder
  private touchLayout(): void {

    Stack({ alignContent: Alignment.Top }) {
      if (this.heroArtwork !== undefined) {
        Image(this.heroArtwork)
          .width('100%')
          .height(HERO_TOUCH_HEIGHT)
          .objectFit(ImageFit.Cover)
          .draggable(false)
          .focusable(false)
      } else {
        Skeleton({ blockWidth: TouchGeometry.homeRailCardWidthLandscape * 4, blockHeight: HERO_TOUCH_HEIGHT, radius: 0 })
      }

      Scroll() {
        Column({ space: TouchGeometry.detailListSpacing }) {
          Column({ space: Spacing.md }) {
            FeatureCopy({ kicker: (this.detail !== null ? kindLabel(this.detail.work.kind) : ''), title: (this.detail !== null ? this.detail.work.title : ''), metaLines: (this.detail !== null ? buildMetaLines(this.detail) : []), synopsis: this.synopsisText() })
            this.playButton(this.primaryMediaFileId !== null, PLAY_BUTTON_HEIGHT_TOUCH)
          }
          .width('100%')
          .alignItems(HorizontalAlign.Start)

          this.railsColumn()
        }
        .padding({
          top: TouchGeometry.detailListTop,
          bottom: TouchGeometry.detailListBottom,
          left: Spacing.lg,
          right: Spacing.lg,
        })
        .width('100%')
        .alignItems(HorizontalAlign.Start)
      }
      .width('100%')
      .height('100%')
    }
    .width('100%')
    .height('100%')
    .backgroundColor(toResourceColor(activeColors().bg))
  }

  @Builder
  private busyOrErrorState(): void {
    if (this.loadFailed) {
      AsyncState({
        kind: AsyncStateKind.Error,
        message: this.errorMessage,
        retryLabel: 'Retry',
        retry: () => {
          this.loadDetail();
        },
      })
    } else {
      AsyncState({ kind: AsyncStateKind.Loading })
    }
  }

  build() {
    NavDestination() {
      if (this.detail === null) {
        Column() {
          this.busyOrErrorState()
        }
        .width('100%')
        .height('100%')
        .justifyContent(FlexAlign.Center)
        .alignItems(HorizontalAlign.Center)
        .backgroundColor(toResourceColor(activeColors().bg))
      } else if (isTvMetrics()) {
        this.tvLayout()
      } else {
        this.touchLayout()
      }
    }
    .hideTitleBar(true)
    .backgroundColor(toResourceColor(activeColors().bg))
  }
}

/**
 * Registered in `profile/router_map.json` as the `Detail` route's
 * `buildFunction` once the navigation-shell slice lands that row (this
 * file's header comment) -- same `(name, param)` entry-point shape the
 * system route table's `NavPathStack.pushPathByName` targets. Decodes
 * `param` as `navigation/Routes.ets`'s `DetailRouteParams` and passes
 * `workId` straight through as `Detail`'s own `@Prop`.
 */
@Builder
export function DetailBuilder(name: string, param: Object): void {
  Detail({ workId: ((param as DetailRouteParams).workId) })
}
