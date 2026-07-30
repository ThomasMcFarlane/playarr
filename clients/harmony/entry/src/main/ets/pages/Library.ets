/**
 * Per-kind catalogue browse grid (brief section 5.10, "Card and rail
 * metrics", library grid row; section 9, Slice 6 acceptance). Pushed onto
 * the shared `NavPathStack` (navigation/NavStack.ets) as the `Library`
 * route (navigation/Routes.ets's `ROUTES.Library`), carrying a
 * `LibraryRouteParams.kind` that selects which catalogue grouping to list
 * (a `data/CatalogRepository.ets` `BrowseQuery.kind` value, e.g. `"movie"`).
 *
 * ## What this page does
 *
 * - Fetches `GET /api/v1/catalog` (via `data/CatalogRepository.ets#getCatalog`,
 *   never a hand-written path) with `kind`, `sort`, `order`, `limit=50` and a
 *   growing `offset`, `available_only=true` always attached by that
 *   repository function itself.
 * - Renders a responsive grid of `design/components/PosterCard.ets` cards
 *   (cover/2:3 artwork, brief 4.9's `COVER_ARTWORK_PRIORITY`), sized per the
 *   brief-5.10 "library grid" row: TV is a fixed `TvGeometry.libraryGridColumns`
 *   (3) column layout at `libraryGridRowGap`/`libraryGridColumnGap`/
 *   `libraryGridCardRadius`; touch is a responsive column count aiming for
 *   `TouchGeometry.libraryGridAdaptiveMid` (164)-wide cards, clamped to the
 *   `[libraryGridAdaptiveMin, libraryGridAdaptiveMax]` (132..206) band -- see
 *   `computeAdaptiveColumns()` below for exactly how "Adaptive(132/164/206)"
 *   is interpreted, since brief 5.10 names three numbers, not a formula, and
 *   ArkUI's `Grid.columnsTemplate` has no native `minmax()`/`auto-fill`
 *   equivalent to defer to. Card width is always derived from the grid's own
 *   REAL measured width (`.onAreaChange`, tracked in `measuredWidthVp`)
 *   rather than assumed from the brief-5.9/5.10 "library backdrop" ratios
 *   (`libraryBackdropLeftPct`/`libraryResultsWidthRatio`) -- that row
 *   describes a backdrop-plus-results-panel TREATMENT this page does not
 *   attempt to reproduce pixel-for-pixel (no way to verify it without a
 *   device or compiler, per this project's whole offline-validation
 *   posture); measuring the real available width is correct regardless of
 *   whatever chrome/backdrop a later polish pass wraps around this grid.
 * - Sort (`title` default | `date_added` | `recent`) and order (`asc`|`desc`)
 *   controls, each a `LibraryChip` below; changing either resets pagination
 *   (offset back to 0, items cleared) and refetches.
 * - A `Library` / `Folders` view control. `Folders` mounts the native
 *   `LibraryFolders` browser, which discovers this kind's source roots and
 *   navigates root-relative file-derived media without replacing this page
 *   or introducing a browser/WebView surface.
 * - Pagination: fetches the next `limit=50` page when the Grid's visible
 *   tail (`.onScrollIndex`'s `last` index, backed up by `.onReachEnd` as a
 *   defensive second trigger) comes within `PAGINATION_LOOKAHEAD` (10) of the
 *   currently loaded tail, per brief 9's "Library paginates when the
 *   focused/scrolled index is within 10 of the loaded tail" -- see the next
 *   paragraph for why "focused" collapses into "scrolled" here.
 * - Tapping/activating a card pushes `ROUTES.Detail` with a `DetailRouteParams`,
 *   the same `navigation/NavStack.ets#pushRoute` contract every other screen
 *   (Home included, once it lands) uses.
 *
 * ## Why pagination is driven ONLY by `.onScrollIndex`/`.onReachEnd`, never
 * a per-card `.onFocus`
 *
 * `design/components/MediaRail.ets`'s own header comment already establishes
 * why: `PosterCard` owns its own `.focusable(true)`/`.onFocus()`/`.onBlur()`/
 * `.onClick()` and does not expose a focus-change callback outward, so
 * wrapping it in a second `.focusable(true)` layer here (just to learn "grid
 * cell N focused") would create the exact duplicate-focus-stop ambiguity
 * that file warns about, one level further up the tree. Instead, this page
 * relies on the same assumption `MediaRail.ets` documents for its own
 * scrolling `List`: a D-pad focus move onto an off-screen `GridItem` causes
 * `Grid` to auto-scroll that item into view, which fires `.onScrollIndex`
 * as a side effect -- so "the focused index" and "the scrolled index" are
 * the same signal here. This is a documented assumption, not a
 * device-verified fact (no ArkTS compiler or device is available while
 * building this slice); if on-device testing shows `Grid` does not
 * auto-scroll (or does not fire `.onScrollIndex`) on a pure focus move with
 * no touch/pointer scroll involved, the fallback is threading an explicit
 * per-cell focus-notify callback through `LibraryGridCell` -- flagged here
 * rather than silently assumed correct, the same posture brief risk R7 and
 * `MediaRail.ets` already establish elsewhere in this codebase.
 *
 * ## `PosterCard` variant
 *
 * `design/components/PosterCard.ets` only supports `variant: 'home' |
 * 'titleEpisode'` (mapping to `FOCUS_LIFT.homeCard`/`.titleEpisodeCard`).
 * `FOCUS_LIFT` also carries a distinct `gridCard` delta
 * (`design/components/FocusLift.ets`), but `PosterCard` has no `'grid'`
 * variant to select it -- that component is already built and reviewed
 * (out of scope for this page to change), so every card below uses the
 * default `'home'` variant, the closest sanctioned option for a browse
 * grid. A future pass that adds a `'grid'` variant to `PosterCard` itself
 * would let this page pick up `FOCUS_LIFT.gridCard` with a one-line change.
 *
 * ## Error decoding without importing `net/`
 *
 * `pages/*.ets` must never import from `net/` or `auth/` directly (brief
 * section 3.1, validator-enforced) -- only `data/` may. This page never
 * imports `ApiResult`/`ApiFailure`/`isApiOk` by name; `getCatalog`'s
 * resolved value is branched on structurally (`result.kind === 'ok'` /
 * `'network_failure'` / `'http_failure'`, `result.envelope.kind === ...`)
 * entirely inline in `loadPage()`, letting TypeScript narrow the type it
 * already inferred from `data/CatalogRepository.ets#getCatalog`'s own return
 * type without this file ever needing to name (and therefore import) the
 * union itself.
 *
 * ## Not yet wired into `router_map.json` / `profile/main_pages.json`
 *
 * `navigation/Routes.ets`'s own header comment reserves `ROUTES.Library`
 * ahead of the slice that lands both this page file AND the matching
 * `router_map.json`/`main_pages.json` rows plus the `Index.ets` `Navigation`
 * host rewrite (the boot state machine, still a placeholder as of this
 * slice) that actually dispatches pushed routes to a `NavDestination`
 * builder. Since that shared route contract is owned by a parallel
 * workflow, this file only writes against the agreed `ROUTES`/`NavStack`
 * names -- `LibraryBuilder`, below, is ready to be referenced the moment
 * that integration lands, with no changes needed here.
 */

import { image } from '@kit.ImageKit';

import { activeColors, toResourceColor } from '../design/Theme';
import type { ThemeModeSetting } from '../design/Theme';
import { tv, isTvMetrics, TvGeometry, TouchGeometry } from '../design/Metrics';
import { INTERACTION_CURVE, INTERACTION_CARD_MS } from '../design/Motion';
import { FOCUS_LIFT, effectiveFocusPercent, DEFAULT_ACTIVE_RAIL_FACTOR } from '../design/components/FocusLift';
import { PosterCard } from '../design/components/PosterCard';
import { AsyncState, AsyncStateKind } from '../design/components/AsyncState';
import { Spacing, Radii } from '../core/Tokens';
import { LibraryFolders } from './LibraryFolders';

import { getCatalog } from '../data/CatalogRepository';
import { fetchWorkArtworkByPriority, COVER_ARTWORK_PRIORITY } from '../data/ArtworkRepository';

import { catalogPageSize } from '../core/AppConfig';
import type { WorkKind } from '../core/Types/Catalog';
import type { Work } from '../core/Types/Work';

import { ROUTES } from '../navigation/Routes';
import type { LibraryRouteParams, DetailRouteParams } from '../navigation/Routes';
import { getNavStack, pushRoute, popRoute } from '../navigation/NavStack';

import { logWarn } from '../util/Log';

const LOG_TAG: string = 'Library';

/** Brief 9, Slice 6: "within 10 of the loaded tail". */
const PAGINATION_LOOKAHEAD: number = 10;

/** Poster/cover artwork is 2:3 (width:height), so height = width * 1.5. */
const COVER_ASPECT_RATIO: number = 1.5;

/** A defensive floor so a not-yet-measured or pathologically narrow layout
 * never computes a zero/negative card size. Not a `core/Tokens.ts` field --
 * a small named UI constant in the same spirit as `PosterCard.ets`'s own
 * `PROGRESS_BAR_HEIGHT`. */
const MIN_CARD_WIDTH_VP: number = 80;

/** Horizontal padding applied to the grid itself; subtracted back out of
 * the `.onAreaChange`-measured width (which reports the border-box size,
 * padding included) so column-width math operates on the real content
 * width available to cards. */
const GRID_HORIZONTAL_PADDING_VP: number = Spacing.lg;

/** `TouchGeometryTokens` has no dedicated library-grid gap field (only the
 * TV column does: `libraryGridRowGap`/`libraryGridColumnGap`) -- reusing the
 * touch rail's own item gap is a reasoned, documented default, not a brief
 * literal. */
const TOUCH_GRID_GAP_VP: number = TouchGeometry.railItemGap;

/** Fallback assumed widths for the single frame before `.onAreaChange`
 * first reports the grid's real measured width. Overwritten immediately
 * once layout completes; see this file's header comment. */
const FALLBACK_TV_GRID_WIDTH_VP: number = 1920;
const FALLBACK_TOUCH_GRID_WIDTH_VP: number = 360;

/** Converts an ArkUI `Length` (`string | number`) into a plain vp number,
 * as reported by `.onAreaChange`'s `Area.width`. Returns `0` for a
 * malformed string rather than `NaN`, so a caller's arithmetic never
 * silently propagates `NaN` into every downstream size. */
function lengthToVp(value: Length): number {
  if (typeof value === 'number') {
    return value;
  }
  const parsed = Number.parseFloat(value);
  if (Number.isNaN(parsed)) {
    return 0;
  }
  return parsed;
}

/**
 * Interprets brief 5.10's touch "Adaptive(132/164/206)" library-grid row as:
 * pick the column count whose resulting card width lands as close as
 * possible to the middle figure (164), then nudge it by one column in
 * either direction if that leaves the resulting card width outside the
 * `[min, max]` (132..206) band. `ArkUI`'s `Grid.columnsTemplate` has no
 * native `repeat(auto-fill, minmax(...))` equivalent to defer to, so the
 * column COUNT is computed here in script and expressed back to `Grid` as a
 * plain `'1fr 1fr ...'` template (`columnsTemplateFor`, below) -- a
 * reasoned interpretation of the brief's three numbers, not an invented one.
 */
function computeAdaptiveColumns(widthVp: number, gapVp: number, minCard: number, midCard: number, maxCard: number): number {
  if (widthVp <= 0) {
    return 1;
  }
  let columns = Math.max(1, Math.round(widthVp / (midCard + gapVp)));
  while (columns > 1 && (widthVp - gapVp * (columns - 1)) / columns < minCard) {
    columns = columns - 1;
  }
  while ((widthVp - gapVp * (columns - 1)) / columns > maxCard) {
    columns = columns + 1;
  }
  return columns;
}

/** Builds the `'1fr 1fr ...'` string `Grid.columnsTemplate` expects for
 * `columns` equal-width tracks. */
function columnsTemplateFor(columns: number): string {
  const tracks: string[] = [];
  for (let i = 0; i < columns; i = i + 1) {
    tracks.push('1fr');
  }
  return tracks.join(' ');
}

/** Display title for the header row. Falls back to a capitalised echo of
 * `kind` for any value outside the five known `WorkKind`s -- `Routes.ets`
 * types `LibraryRouteParams.kind` as a plain `string`, not `WorkKind`, so an
 * unrecognised value must never crash this page. */
function libraryKindTitle(kind: string): string {
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
    return 'Artists';
  }
  if (kind === 'author') {
    return 'Authors';
  }
  if (kind.length === 0) {
    return 'Library';
  }
  return kind.charAt(0).toUpperCase() + kind.slice(1);
}

/** A card's subtitle: the release year, or `''` (hidden by `PosterCard`)
 * when `release_date` is absent or malformed. */
function releaseYearOf(work: Work): string {
  const raw = work.release_date;
  if (raw === null) {
    return '';
  }
  if (raw.length < 4) {
    return '';
  }
  return raw.slice(0, 4);
}

interface LibrarySortOption {
  value: string;
  label: string;
}

type LibraryViewMode = 'library' | 'folders';

/** Brief 4.8 / 9: `sort` is `"title"` (default) | `"date_added"` |
 * `"recent"`. Listed in the brief's own order. */
const SORT_OPTIONS: LibrarySortOption[] = [
  { value: 'title', label: 'Title' },
  { value: 'date_added', label: 'Date Added' },
  { value: 'recent', label: 'Recent' },
];

/**
 * One small pill-shaped control: the back affordance, a sort option, or the
 * order toggle all reuse this, rather than three bespoke styles. Mirrors
 * `design/components/AsyncState.ets`'s own retry button treatment
 * (`FOCUS_LIFT.button`, never rail-scoped so it passes
 * `DEFAULT_ACTIVE_RAIL_FACTOR`).
 */
@Component
struct LibraryChip {
  label: string = '';
  @Prop selected: boolean = false;

  /** Plain (non-reactive) callback field -- functions are not observable
   * state, the same pattern `PosterCard.ets`'s `onSelect` and
   * `AsyncState.ets`'s `retry` already establish. */
  onActivate: () => void = () => {};

  // Tracked purely to force a re-render when the theme changes; the actual
  // colour decision always goes through design/Theme.ets's own resolver
  // functions (see that file's header comment for this pattern).
  @StorageProp('colorMode') private sysColorMode: ColorMode = ColorMode.Light;
  @StorageProp('themeModeSetting') private themeSetting: ThemeModeSetting = 'system';

  @State private focusPercent: number = 0;

  private setFocused(focused: boolean): void {
    this.getUIContext().animateTo({ duration: INTERACTION_CARD_MS, curve: INTERACTION_CURVE }, () => {
      this.focusPercent = focused ? 1 : 0;
    });
  }

  build() {
    const effective = effectiveFocusPercent(this.focusPercent, DEFAULT_ACTIVE_RAIL_FACTOR);
    const scale = 1 + (FOCUS_LIFT.button.scale - 1) * effective;
    const isSelected = this.selected;
    const chipLabel = this.label;
    const activate = this.onActivate;
    const bg = isSelected ? activeColors().accent : activeColors().surfaceSoft;
    const fg = isSelected ? activeColors().onAccent : activeColors().ink;

    Text(chipLabel)
      .fontSize(13)
      .fontWeight(FontWeight.Medium)
      .fontColor(toResourceColor(fg))
      .padding({ left: Spacing.md, right: Spacing.md, top: Spacing.xs, bottom: Spacing.xs })
      .backgroundColor(toResourceColor(bg))
      .borderRadius(Radii.pillFull)
      .focusable(true)
      .onFocus(() => {
        this.setFocused(true);
      })
      .onBlur(() => {
        this.setFocused(false);
      })
      .scale({ x: scale, y: scale })
      .onClick(() => {
        activate();
      })
  }
}

/** Satisfies `LibraryGridCell.work`'s field default -- never actually
 * rendered (every real cell is constructed with a real `Work` from a
 * fetched `CatalogPage`), the same placeholder-constant idiom
 * `design/components/NavRail.ets`/`NavPill.ets` already use for their own
 * item structs. */
const PLACEHOLDER_WORK: Work = {
  id: '',
  kind: 'movie',
  external_refs: [],
  title: '',
  sort_title: '',
  overview: null,
  images: [],
  genres: [],
  tags: [],
  added_at: '',
  release_date: null,
  monitored: false,
  availability: 'unknown',
};

/**
 * One grid cell: owns its OWN artwork fetch (`data/ArtworkRepository.ets`,
 * cover priority) in `aboutToAppear()`, independent of every other cell, so
 * a newly-appended page of items only ever fetches artwork for the items it
 * actually added -- `ForEach` (keyed by `work.id`) leaves already-mounted
 * cells untouched across a pagination append, and `ArtworkRepository.ets`'s
 * own in-memory LRU protects against a redundant fetch even if a cell were
 * ever re-mounted regardless.
 */
@Component
struct LibraryGridCell {
  work: Work = PLACEHOLDER_WORK;
  cardWidth: number = 0;
  cardHeight: number = 0;
  cardRadius: number = 0;

  /** Plain (non-reactive) callback field, called with the activated card's
   * `Work.id`. */
  onSelect: (workId: string) => void = () => {};

  @State private artwork: image.PixelMap | undefined = undefined;

  aboutToAppear(): void {
    this.loadArtwork();
  }

  private async loadArtwork(): Promise<void> {
    const workId = this.work.id;
    const result = await fetchWorkArtworkByPriority(workId, COVER_ARTWORK_PRIORITY);
    if (result.kind === 'ok') {
      this.artwork = result.value;
    }
    // A failure (including the normal "no artwork of any priority kind"
    // 404) is left alone -- PosterCard already renders a Skeleton
    // placeholder whenever `artwork` stays `undefined`.
  }

  build() {
    const artwork = this.artwork;
    const width = this.cardWidth;
    const height = this.cardHeight;
    const radius = this.cardRadius;
    const title = this.work.title;
    const subtitle = releaseYearOf(this.work);
    const workId = this.work.id;
    const dispatch = this.onSelect;

    PosterCard({
      artwork: artwork,
      width: width,
      height: height,
      artworkRadius: radius,
      title: title,
      subtitle: subtitle,
      onSelect: () => {
        dispatch(workId);
      },
    })
  }
}

@Component
export struct Library {
  /** Set once at construction from `LibraryRouteParams.kind`; never
   * mutated by this page itself. */
  @Prop kind: string = '';

  @State private items: Work[] = [];
  @State private isLoading: boolean = true;
  @State private isLoadingMore: boolean = false;
  @State private hasMore: boolean = true;
  @State private errorMessage: string = '';
  @State private loadMoreFailed: boolean = false;
  @State private sort: string = 'title';
  @State private order: string = 'asc';
  @State private viewMode: LibraryViewMode = 'library';
  @State private measuredWidthVp: number = 0;

  // Tracked purely to force a re-render on theme / TV-scale change; the
  // actual values always go through design/Theme.ets's resolvers and
  // design/Metrics.ets's tv() below (see those files' own header comments
  // for this exact pattern -- also NavRail.ets's/NavTile's identical
  // fields).
  @StorageProp('colorMode') private sysColorMode: ColorMode = ColorMode.Light;
  @StorageProp('themeModeSetting') private themeSetting: ThemeModeSetting = 'system';
  @StorageProp('tvScaleFactor') private trackedTvScale: number = 1;

  aboutToAppear(): void {
    this.loadPage(0);
  }

  private availableGridWidthVp(): number {
    const measured = this.measuredWidthVp > 0
      ? this.measuredWidthVp
      : (isTvMetrics() ? FALLBACK_TV_GRID_WIDTH_VP : FALLBACK_TOUCH_GRID_WIDTH_VP);
    return Math.max(0, measured - GRID_HORIZONTAL_PADDING_VP * 2);
  }

  private gridColumnGapVp(): number {
    return isTvMetrics() ? tv(TvGeometry.libraryGridColumnGap) : TOUCH_GRID_GAP_VP;
  }

  private gridRowGapVp(): number {
    return isTvMetrics() ? tv(TvGeometry.libraryGridRowGap) : TOUCH_GRID_GAP_VP;
  }

  private gridCardRadiusVp(): number {
    return isTvMetrics() ? tv(TvGeometry.libraryGridCardRadius) : Radii.homeCardArtworkTouch;
  }

  private gridColumnCount(): number {
    if (isTvMetrics()) {
      return TvGeometry.libraryGridColumns;
    }
    const width = this.availableGridWidthVp();
    const gap = this.gridColumnGapVp();
    return computeAdaptiveColumns(
      width,
      gap,
      TouchGeometry.libraryGridAdaptiveMin,
      TouchGeometry.libraryGridAdaptiveMid,
      TouchGeometry.libraryGridAdaptiveMax
    );
  }

  private gridCardWidthVp(): number {
    const columns = this.gridColumnCount();
    const gap = this.gridColumnGapVp();
    const width = this.availableGridWidthVp();
    const raw = (width - gap * (columns - 1)) / columns;
    return Math.max(MIN_CARD_WIDTH_VP, raw);
  }

  private gridCardHeightVp(): number {
    return this.gridCardWidthVp() * COVER_ASPECT_RATIO;
  }

  private resetAndReload(): void {
    this.items = [];
    this.hasMore = true;
    this.errorMessage = '';
    this.loadMoreFailed = false;
    this.loadPage(0);
  }

  private setSort(next: string): void {
    if (this.sort === next) {
      return;
    }
    this.sort = next;
    this.resetAndReload();
  }

  private toggleOrder(): void {
    this.order = this.order === 'asc' ? 'desc' : 'asc';
    this.resetAndReload();
  }

  private setViewMode(next: LibraryViewMode): void {
    this.viewMode = next;
  }

  /** Brief 9, Slice 6: "paginates when the focused/scrolled index is
   * within 10 of the loaded tail" -- see this file's header comment on why
   * `Grid`'s own scroll/reach-end signals stand in for "focused" too. */
  private maybeLoadMore(lastVisibleIndex: number): void {
    if (!this.hasMore || this.isLoading || this.isLoadingMore) {
      return;
    }
    const remaining = this.items.length - 1 - lastVisibleIndex;
    if (remaining > PAGINATION_LOOKAHEAD) {
      return;
    }
    this.loadPage(this.items.length);
  }

  private openDetail(workId: string): void {
    const params: DetailRouteParams = { workId: workId };
    pushRoute(getNavStack(), ROUTES.Detail, params);
  }

  private async loadPage(offset: number): Promise<void> {
    if (offset === 0) {
      this.isLoading = true;
    } else {
      this.isLoadingMore = true;
      this.loadMoreFailed = false;
    }

    const rawKind = this.kind;
    const effectiveKind = rawKind.length > 0 ? (rawKind as WorkKind) : undefined;
    const sortValue = this.sort;
    const orderValue = this.order;

    const result = await getCatalog({
      kind: effectiveKind,
      sort: sortValue,
      order: orderValue,
      limit: catalogPageSize,
      offset: offset,
    });

    if (result.kind === 'ok') {
      const page = result.value;
      const existingItems = this.items;
      const nextItems: Work[] = offset === 0 ? [] : existingItems.slice();
      for (const work of page.items) {
        nextItems.push(work);
      }
      const total = page.total;
      const reachedTotal = total !== null && nextItems.length >= total;
      this.items = nextItems;
      this.hasMore = page.items.length >= catalogPageSize && !reachedTotal;
      this.errorMessage = '';
      this.loadMoreFailed = false;
    } else {
      let message = 'Something went wrong. Please try again.';
      if (result.kind === 'network_failure') {
        message = result.message;
      } else if (result.kind === 'http_failure') {
        const envelope = result.envelope;
        if (envelope.kind === 'general') {
          message = envelope.message;
        } else if (envelope.kind === 'upgrade_required') {
          message = 'Update Playarr to continue.';
        } else if (envelope.kind === 'oauth') {
          message = 'Your session has expired. Please sign in again.';
        }
      }
      logWarn(LOG_TAG, 'catalog fetch failed (offset=' + String(offset) + '): ' + message);
      if (offset === 0) {
        this.errorMessage = message;
      } else {
        this.loadMoreFailed = true;
      }
    }

    this.isLoading = false;
    this.isLoadingMore = false;
  }

  build() {
    const libraryKind = this.kind;
    const title = libraryKindTitle(libraryKind);
    const sortValue = this.sort;
    const viewMode = this.viewMode;
    const orderLabel = this.order === 'asc' ? 'Order: Asc' : 'Order: Desc';
    const loading = this.isLoading;
    const loadingMore = this.isLoadingMore;
    const loadMoreFailed = this.loadMoreFailed;
    const errorMessage = this.errorMessage;
    const itemCount = this.items.length;
    const gridItems = this.items;
    const columns = this.gridColumnCount();
    const columnGap = this.gridColumnGapVp();
    const rowGap = this.gridRowGapVp();
    const cardRadius = this.gridCardRadiusVp();
    const cardWidth = this.gridCardWidthVp();
    const cardHeight = this.gridCardHeightVp();
    const columnsTemplate = columnsTemplateFor(columns);

    NavDestination() {
      Column() {
        Row({ space: Spacing.sm }) {
          LibraryChip({
            label: '‹ Back',
            selected: false,
            onActivate: () => {
              popRoute(getNavStack());
            },
          })

          Text(title)
            .fontSize(20)
            .fontWeight(FontWeight.Bold)
            .fontColor(toResourceColor(activeColors().ink))
            .layoutWeight(1)
            .maxLines(1)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
        }
        .width('100%')
        .padding({ left: Spacing.lg, right: Spacing.lg, top: Spacing.md, bottom: Spacing.sm })

        List({ space: Spacing.xs }) {
          ListItem() {
            LibraryChip({
              label: 'Library',
              selected: viewMode === 'library',
              onActivate: () => {
                this.setViewMode('library');
              },
            })
          }

          ListItem() {
            LibraryChip({
              label: 'Folders',
              selected: viewMode === 'folders',
              onActivate: () => {
                this.setViewMode('folders');
              },
            })
          }

          if (viewMode === 'library') {
            ForEach(
              SORT_OPTIONS,
              (option: LibrarySortOption) => {
                ListItem() {
                  LibraryChip({
                    label: option.label,
                    selected: option.value === sortValue,
                    onActivate: () => {
                      this.setSort(option.value);
                    },
                  })
                }
              },
              (option: LibrarySortOption): string => option.value
            )

            ListItem() {
              LibraryChip({
                label: orderLabel,
                selected: true,
                onActivate: () => {
                  this.toggleOrder();
                },
              })
            }
          }
        }
        .listDirection(Axis.Horizontal)
        .scrollBar(BarState.Auto)
        .edgeEffect(EdgeEffect.Spring)
        .height(isTvMetrics() ? tv(48) : 42)
        .width('100%')
        .padding({ left: Spacing.lg, right: Spacing.lg, bottom: Spacing.sm })

        if (viewMode === 'library' && loadingMore) {
          Row() {
            AsyncState({ kind: AsyncStateKind.Loading })
          }
          .width('100%')
          .height(32)
          .justifyContent(FlexAlign.Center)
        }

        if (viewMode === 'library' && loadMoreFailed && !loadingMore) {
          Text("Couldn't load more. Scroll to try again.")
            .fontSize(12)
            .fontColor(toResourceColor(activeColors().inkMuted))
            .textAlign(TextAlign.Center)
            .width('100%')
            .padding({ top: Spacing.xs, bottom: Spacing.xs })
        }

        if (viewMode === 'folders') {
          LibraryFolders({ kind: libraryKind })
            .layoutWeight(1)
            .width('100%')
        } else if (loading) {
          AsyncState({ kind: AsyncStateKind.Loading })
            .layoutWeight(1)
            .width('100%')
        } else if (itemCount === 0 && errorMessage.length > 0) {
          AsyncState({
            kind: AsyncStateKind.Error,
            message: errorMessage,
            retry: () => {
              this.resetAndReload();
            },
          })
            .layoutWeight(1)
            .width('100%')
        } else if (itemCount === 0) {
          AsyncState({ kind: AsyncStateKind.Empty, message: 'No titles found.' })
            .layoutWeight(1)
            .width('100%')
        } else {
          Grid() {
            ForEach(
              gridItems,
              (work: Work) => {
                GridItem() {
                  LibraryGridCell({
                    work: work,
                    cardWidth: cardWidth,
                    cardHeight: cardHeight,
                    cardRadius: cardRadius,
                    onSelect: (workId: string) => {
                      this.openDetail(workId);
                    },
                  })
                }
              },
              (work: Work): string => work.id
            )
          }
          .columnsTemplate(columnsTemplate)
          .columnsGap(columnGap)
          .rowsGap(rowGap)
          .edgeEffect(EdgeEffect.Spring)
          .padding({ left: Spacing.lg, right: Spacing.lg, bottom: Spacing.lg })
          .onAreaChange((_oldValue: Area, newValue: Area) => {
            this.measuredWidthVp = lengthToVp(newValue.width);
          })
          .onScrollIndex((_first: number, last: number) => {
            this.maybeLoadMore(last);
          })
          .onReachEnd(() => {
            this.maybeLoadMore(itemCount - 1);
          })
          .layoutWeight(1)
          .width('100%')
        }
      }
      .width('100%')
      .height('100%')
      .alignItems(HorizontalAlign.Start)
      .backgroundColor(toResourceColor(activeColors().bg))
    }
    .hideTitleBar(true)
  }
}

/**
 * Registered in `profile/router_map.json` as the `Library` route's
 * `buildFunction`, once the navigation-shell slice adds that row (see this
 * file's header comment) -- the system router table then constructs this
 * `NavDestination` by name, handing back the exact params `NavStack.ets#pushRoute`
 * pushed with. `_name` is unused (every push always means "show the Library
 * page"); kept named, rather than dropped, to match the fixed two-parameter
 * shape `router_map.json` invokes every `buildFunction` with.
 */
@Builder
export function LibraryBuilder(_name: string, param: Object): void {
  const routeParams = param as LibraryRouteParams;
  Library({ kind: routeParams.kind })
}
