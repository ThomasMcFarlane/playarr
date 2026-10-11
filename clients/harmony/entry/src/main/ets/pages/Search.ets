/**
 * Catalogue search, TV layout (web `pages/Search.tsx`): the shell rail, a round Back and "Search", the search
 * pill with its prompt on the left, and on the right either the empty state or a 3-column grid of landscape
 * results. Typing searches after a short pause, as web. Geometry copies the live web TV DOM at 1920x1080.
 *
 * Not yet here (13.10017): the Filters tile and drawer, recent searches, unseen dots on results.
 */

import { image } from '@kit.ImageKit';

import { activeColors, toResourceColor, toResourceColorWithAlpha, tintFilter } from '../design/Theme';
import type { ThemeModeSetting } from '../design/Theme';
import { tv, TvGeometry } from '../design/Metrics';
import { NavRail } from '../design/components/NavRail';
import type { NavRailItem } from '../design/components/NavRail';
import { PlayarrLogo } from '../design/components/PlayarrLogo';
import { Clock } from '../design/components/Clock';
import { PosterCard } from '../design/components/PosterCard';
import { BRAND_PINK } from '../core/Tokens';

import { getCatalogKinds, searchCatalog } from '../data/CatalogRepository';
import { fetchWorkArtworkByPriority, LANDSCAPE_ARTWORK_PRIORITY } from '../data/ArtworkRepository';
import type { Work } from '../core/Types/Work';

import { SEARCH_NAV_ID, buildNavRailItems, buildPrimaryNavItems, buildSecondaryNavItems, navigateFromRail } from '../navigation/NavItems';
import { ROUTES } from '../navigation/Routes';
import type { DetailRouteParams } from '../navigation/Routes';
import { getNavStack, popRoute, pushRoute } from '../navigation/NavStack';

// Web `.tv-search-form`: a 590x76 pill at (154, 173), surfaceStrong at 0.88, 24 px icon, 17.664 px text.
const FORM_TOP: number = 173;
const FORM_WIDTH: number = 590;
const FORM_HEIGHT: number = 76;
const FORM_BG_ALPHA: number = 0.88;
const FORM_PADDING_LEFT: number = 25;
const ICON_SIZE: number = 24;
const INPUT_SIZE: number = 17.664;
// Web `.tv-search-prompt`: 13.824 px soft ink at y=303, 282 wide.
const PROMPT_TOP: number = 303;
const PROMPT_WIDTH: number = 282;
const PROMPT_SIZE: number = 13.824;
// Web results grid: 327x184 cards from (826, 173), 353 column pitch, 251 row pitch.
const RESULTS_LEFT: number = 826;
const RESULTS_TOP: number = 173;
const CARD_WIDTH: number = 327;
const CARD_HEIGHT: number = 184;
const COLUMN_GAP: number = 26;
const ROW_GAP: number = 38;
const COLUMNS: number = 3;
// Web empty state: a 132 px round art with the pink search glyph, then the message.
const EMPTY_LEFT: number = 1163;
const EMPTY_TOP: number = 312;
const EMPTY_ART_SIZE: number = 132;
const EMPTY_GLYPH_SIZE: number = 54;
const EMPTY_TEXT_SIZE: number = 16.896;
const EMPTY_GAP: number = 42;
// Web back button and title (shared header look).
const HEADER_SIZE: number = 50;
const BACK_GLYPH_SIZE: number = 17.28;
const TITLE_SIZE: number = 33.6;
const TITLE_LETTER_SPACING: number = -1.512;
const HEADER_GAP: number = 23;
const SEARCH_DEBOUNCE_MS: number = 300;

function kindLabel(work: Work): string {
  if (work.kind === 'movie') {
    return 'Movie';
  }
  if (work.kind === 'series') {
    return 'Series';
  }
  return work.kind === 'artist' ? 'Artist' : 'Title';
}

function resultCaption(work: Work): string {
  const year = work.release_date !== null && work.release_date.length >= 4 ? work.release_date.slice(0, 4) : '';
  return year.length > 0 ? `${kindLabel(work)} · ${year}` : kindLabel(work);
}

@Component
struct SearchResultCard {
  work: Work | undefined = undefined;
  onSelect: (workId: string) => void = () => {};

  @State private artwork: image.PixelMap | undefined = undefined;

  aboutToAppear(): void {
    this.loadArtwork();
  }

  private async loadArtwork(): Promise<void> {
    if (this.work === undefined) {
      return;
    }
    const result = await fetchWorkArtworkByPriority(this.work.id, LANDSCAPE_ARTWORK_PRIORITY);
    if (result.kind === 'ok') {
      this.artwork = result.value;
    }
  }

  build() {
    PosterCard({
      artwork: this.artwork,
      cardWidth: tv(CARD_WIDTH),
      cardHeight: tv(CARD_HEIGHT),
      title: this.work !== undefined ? this.work.title : '',
      subtitle: this.work !== undefined ? resultCaption(this.work) : '',
      onSelect: () => {
        if (this.work !== undefined) {
          this.onSelect(this.work.id);
        }
      },
    })
  }
}

@Component
export struct SearchScreen {
  @StorageProp('colorMode') private sysColorMode: ColorMode = ColorMode.LIGHT;
  @StorageProp('themeModeSetting') private themeSetting: ThemeModeSetting = 'system';
  @StorageProp('tvScaleFactor') private trackedTvScale: number = 1;

  @State private query: string = '';
  @State private results: Work[] = [];
  @State private searched: boolean = false;
  @State private navItems: NavRailItem[] = [];
  private debounce: number = -1;
  /** Only the latest search may set results (an earlier, slower one must not overwrite them). */
  private searchSerial: number = 0;

  aboutToAppear(): void {
    this.loadNav();
  }

  aboutToDisappear(): void {
    clearTimeout(this.debounce);
  }

  private async loadNav(): Promise<void> {
    const kinds = await getCatalogKinds();
    this.navItems = buildNavRailItems(kinds.kind === 'ok' ? kinds.value : []);
  }

  private onQueryChange(value: string): void {
    this.query = value;
    clearTimeout(this.debounce);
    this.debounce = setTimeout((): void => {
      this.runSearch(value);
    }, SEARCH_DEBOUNCE_MS);
  }

  private async runSearch(value: string): Promise<void> {
    const serial = ++this.searchSerial;
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      this.results = [];
      this.searched = false;
      return;
    }
    const result = await searchCatalog(trimmed);
    if (serial !== this.searchSerial) {
      return;
    }
    this.results = result.kind === 'ok' ? result.value.items : [];
    this.searched = true;
  }

  private openDetail(workId: string): void {
    const params: DetailRouteParams = { workId: workId };
    pushRoute(getNavStack(), ROUTES.Detail, params);
  }

  @Builder
  private emptyState(message: string): void {
    Row({ space: tv(EMPTY_GAP) }) {
      Stack() {
        Image($r('app.media.nav_search'))
          .width(tv(EMPTY_GLYPH_SIZE))
          .height(tv(EMPTY_GLYPH_SIZE))
          .colorFilter(tintFilter(BRAND_PINK))
      }
      .width(tv(EMPTY_ART_SIZE))
      .height(tv(EMPTY_ART_SIZE))
      .borderRadius(tv(EMPTY_ART_SIZE / 2))
      .backgroundColor(toResourceColorWithAlpha(activeColors().surfaceStrong, 0.54))
      .border({ width: 1, color: toResourceColorWithAlpha(activeColors().ink, 0.115) })
      Text(message)
        .fontSize(tv(EMPTY_TEXT_SIZE))
        .fontWeight(FontWeight.Medium)
        .fontColor(toResourceColor(activeColors().ink))
    }
    .alignItems(VerticalAlign.Center)
    .position({ x: tv(EMPTY_LEFT), y: tv(EMPTY_TOP) })
  }

  @Builder
  private resultsGrid(): void {
    Grid() {
      ForEach(this.results, (work: Work) => {
        GridItem() {
          SearchResultCard({
            work: work,
            onSelect: (workId: string) => {
              this.openDetail(workId);
            },
          })
        }
      }, (work: Work): string => work.id)
    }
    .columnsTemplate('1fr 1fr 1fr')
    .columnsGap(tv(COLUMN_GAP))
    .rowsGap(tv(ROW_GAP))
    .width(tv(CARD_WIDTH * COLUMNS + COLUMN_GAP * (COLUMNS - 1)))
    .height('100%')
    .padding({ top: tv(RESULTS_TOP), bottom: tv(RESULTS_TOP) })
    .scrollBar(BarState.Off)
    .edgeEffect(EdgeEffect.None)
    .position({ x: tv(RESULTS_LEFT), y: 0 })
  }

  build() {
    NavDestination() {
      Stack() {
        if (this.results.length > 0) {
          this.resultsGrid()
        } else {
          this.emptyState(this.searched ? 'No matching titles or playlists.' : 'Start typing to search.')
        }
        if (this.navItems.length > 0) {
          NavRail({
            items: this.navItems,
            primaryItems: buildPrimaryNavItems(),
            secondaryItems: buildSecondaryNavItems(),
            selectedId: SEARCH_NAV_ID,
            onSelect: (id: string): void => {
              navigateFromRail(id, SEARCH_NAV_ID);
            },
          })
        }
        PlayarrLogo({ logoSize: tv(TvGeometry.logoSize) })
          .position({ x: tv(TvGeometry.logoLeft), y: tv(TvGeometry.logoTop) })
        Row() {
          Clock()
        }
        .height(tv(TvGeometry.utilityRowHeight))
        .alignItems(VerticalAlign.Center)
        .position({ x: tv(TvGeometry.clockLeft), y: tv(TvGeometry.utilityRowTop) })
        Row({ space: tv(HEADER_GAP) }) {
          Text('←')
            .fontSize(tv(BACK_GLYPH_SIZE))
            .fontWeight(FontWeight.Bold)
            .fontColor(toResourceColor(activeColors().inkSoft))
            .textAlign(TextAlign.Center)
            .width(tv(HEADER_SIZE))
            .height(tv(HEADER_SIZE))
            .borderRadius(tv(HEADER_SIZE / 2))
            .backgroundColor(toResourceColorWithAlpha(activeColors().surfaceStrong, 0.7))
            .focusable(true)
            .onClick(() => {
              popRoute(getNavStack());
            })
          Text('Search')
            .fontSize(tv(TITLE_SIZE))
            .fontWeight(FontWeight.Medium)
            .letterSpacing(tv(TITLE_LETTER_SPACING))
            .fontColor(toResourceColor(activeColors().ink))
        }
        .height(tv(HEADER_SIZE))
        .alignItems(VerticalAlign.Center)
        .position({ x: tv(TvGeometry.titlePanelLeft), y: tv(TvGeometry.utilityRowTop) })
        Row({ space: tv(12) }) {
          Image($r('app.media.nav_search'))
            .width(tv(ICON_SIZE))
            .height(tv(ICON_SIZE))
            .colorFilter(tintFilter(activeColors().inkSoft))
          TextInput({ text: this.query, placeholder: 'Search your libraries and playlists' })
            .fontSize(tv(INPUT_SIZE))
            .fontColor(toResourceColor(activeColors().ink))
            .placeholderColor(toResourceColor(activeColors().inkMuted))
            .backgroundColor(Color.Transparent)
            // The pill is the field (web): no inner box or focus border on the input itself.
            .border({ width: 0 })
            .borderRadius(0)
            .padding(0)
            .caretColor(toResourceColor(activeColors().ink))
            .layoutWeight(1)
            .defaultFocus(true)
            .onChange((value: string) => {
              this.onQueryChange(value);
            })
        }
        .width(tv(FORM_WIDTH))
        .height(tv(FORM_HEIGHT))
        .padding({ left: tv(FORM_PADDING_LEFT), right: tv(FORM_PADDING_LEFT) })
        .borderRadius(tv(FORM_HEIGHT / 2))
        .backgroundColor(toResourceColorWithAlpha(activeColors().surfaceStrong, FORM_BG_ALPHA))
        .border({ width: 1, color: toResourceColorWithAlpha(activeColors().ink, 0.176) })
        .position({ x: tv(TvGeometry.titlePanelLeft), y: tv(FORM_TOP) })
        Text('Find any available movie, series, artist or playlist.')
          .fontSize(tv(PROMPT_SIZE))
          .fontColor(toResourceColor(activeColors().inkSoft))
          .width(tv(PROMPT_WIDTH))
          .position({ x: tv(TvGeometry.titlePanelLeft), y: tv(PROMPT_TOP) })
      }
      .width('100%')
      .height('100%')
      .backgroundColor(toResourceColor(activeColors().bg))
    }
    .hideTitleBar(true)
  }
}

/** Registered in `profile/router_map.json` as the `Search` route's `buildFunction`. */
@Builder
export function SearchBuilder(): void {
  SearchScreen()
}
