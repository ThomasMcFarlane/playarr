/**
 * The release calendar, TV agenda view (web `pages/Calendar.tsx`, which TV opens on the agenda): 30 days from
 * today grouped by local day, each entry a card whose left border shows availability (have it versus not,
 * never the library), and a details panel on the left that follows focus. Previous/Today/Next page by 30
 * days, as web. Rules live in `core/CalendarAgenda.ts`; geometry copies the live web TV DOM at 1920x1080.
 *
 * Not yet here (13.10016): the month and week views and the range picker, the Filters and Calendar link
 * tiles (13.10019), the details panel's actions.
 */

import { activeColors, toResourceColor, toResourceColorWithAlpha } from '../design/Theme';
import type { ThemeModeSetting } from '../design/Theme';
import { tv, TvGeometry } from '../design/Metrics';
import { Stage } from '../design/components/Stage';
import { NavRail } from '../design/components/NavRail';
import type { NavRailItem } from '../design/components/NavRail';
import { PlayarrLogo } from '../design/components/PlayarrLogo';
import { Clock } from '../design/components/Clock';
import { AsyncState, AsyncStateKind } from '../design/components/AsyncState';

import { getCatalogKinds } from '../data/CatalogRepository';
import { getCalendar } from '../data/CalendarRepository';

import {
  AGENDA_DAYS,
  addDays,
  agendaRangeLabel,
  dayHeading,
  entryAvailable,
  entryPillTone,
  entrySubtitle,
  entryTimeLabel,
  entryWhenLabel,
  groupByLocalDay,
  localDayOf,
  mediaKindLabel,
  pillLabel,
  releaseTypeLabel,
} from '../core/CalendarAgenda';
import type { DayGroup, EntryPillTone } from '../core/CalendarAgenda';
import type { CalendarEntry } from '../core/Types/Calendar';

import { CALENDAR_NAV_ID, HOME_NAV_ID, buildNavRailItems, buildSecondaryNavItems } from '../navigation/NavItems';
import { ROUTES } from '../navigation/Routes';
import type { DetailRouteParams, LibraryRouteParams } from '../navigation/Routes';
import { getNavStack, popRoute, pushRoute, replaceRoute } from '../navigation/NavStack';

// Web `.calendar-days-agenda`: from x=783 (53 into the x=730 column), first day heading at y=162, 1033 wide.
const LIST_INSET_LEFT: number = 53;
const LIST_TOP: number = 162;
const LIST_WIDTH: number = 1033;
// Day heading 18.4/640 on a 44 high band; 32 from the band to the first card; 32 between days; 14 between cards.
const DAY_HEADING_SIZE: number = 18.4;
const DAY_HEADING_HEIGHT: number = 44;
const DAY_HEADING_GAP: number = 32;
const DAY_GAP: number = 32;
const ENTRY_GAP: number = 13;
const TODAY_TAG_SIZE: number = 11.2;
const TODAY_TAG_LETTER_SPACING: number = 0.896;
// Web `.calendar-entry`: 107 high, 12 radius, 1px line border with a 4px availability edge, surfaceStrong.
const ENTRY_HEIGHT: number = 107;
const ENTRY_RADIUS: number = 12;
const ENTRY_EDGE: number = 4;
const ENTRY_PADDING_LEFT: number = 12;
const POSTER_WIDTH: number = 40;
const POSTER_HEIGHT: number = 60;
const POSTER_RADIUS: number = 6;
const POSTER_GAP: number = 15;
const ENTRY_TITLE_SIZE: number = 19.2;
const ENTRY_META_SIZE: number = 12.8;
const ENTRY_META_GAP: number = 12;
// Web `.status-pill`: 13.44/750, tone at 14% over the surface with a 60% tone border.
const PILL_SIZE: number = 13.44;
const PILL_HEIGHT: number = 27;
const PILL_PADDING_H: number = 10;
// Header controls: web `.page-actions-navigation`, 50 high pills at the right edge.
const HEADER_CONTROL_SIZE: number = 50;
const HEADER_CONTROL_FONT: number = 14.72;
const HEADER_CONTROL_GAP: number = 15;
const HEADER_RIGHT: number = 1844;
const BACK_GLYPH_SIZE: number = 17.28;
const TITLE_SIZE: number = 33.6;
const TITLE_LETTER_SPACING: number = -1.512;
const HEADER_GAP: number = 23;
// Details panel extras under the meta line.
const PANEL_GAP: number = 17;
const OVERVIEW_SIZE: number = 13.824;
const OVERVIEW_LINE_HEIGHT: number = 22;
const OVERVIEW_MAX_LINES: number = 5;
const OVERVIEW_WIDTH: number = 348;

const SUCCESS: string = 'rgba(57, 181, 120, 1)';

function pillToneColor(tone: EntryPillTone): string {
  if (tone === 'available') {
    return SUCCESS;
  }
  if (tone === 'upcoming') {
    return 'rgba(207, 49, 87, 1)';
  }
  if (tone === 'missing') {
    return 'rgba(220, 80, 80, 1)';
  }
  return 'rgba(194, 181, 187, 1)';
}

function pillToneFill(tone: EntryPillTone): string {
  if (tone === 'available') {
    return 'rgba(42, 52, 46, 1)';
  }
  if (tone === 'upcoming') {
    return 'rgba(52, 28, 35, 1)';
  }
  if (tone === 'missing') {
    return 'rgba(57, 44, 47, 1)';
  }
  return 'rgba(48, 44, 47, 1)';
}

@Component
export struct Calendar {
  @StorageProp('colorMode') private sysColorMode: ColorMode = ColorMode.LIGHT;
  @StorageProp('themeModeSetting') private themeSetting: ThemeModeSetting = 'system';
  @StorageProp('tvScaleFactor') private trackedTvScale: number = 1;

  @State private today: string = localDayOf(new Date());
  @State private start: string = localDayOf(new Date());
  @State private groups: DayGroup[] = [];
  @State private selected: CalendarEntry | undefined = undefined;
  @State private loading: boolean = true;
  @State private errorMessage: string = '';
  @State private navItems: NavRailItem[] = [];

  aboutToAppear(): void {
    this.load();
    this.loadNav();
  }

  private async loadNav(): Promise<void> {
    const kinds = await getCatalogKinds();
    this.navItems = buildNavRailItems(kinds.kind === 'ok' ? kinds.value : []);
  }

  private async load(): Promise<void> {
    this.loading = true;
    const end = addDays(this.start, AGENDA_DAYS - 1);
    // Entries are bucketed by local day, up to a day either side of UTC: pad the window by a day.
    const result = await getCalendar(addDays(this.start, -1), addDays(end, 1));
    if (result.kind === 'ok') {
      this.groups = groupByLocalDay(result.value.entries, this.start, end);
      this.selected = this.groups.length > 0 ? this.groups[0].entries[0] : undefined;
      this.errorMessage = '';
    } else {
      this.groups = [];
      this.selected = undefined;
      this.errorMessage = 'Could not load the calendar.';
    }
    this.loading = false;
  }

  private page(direction: number): void {
    this.start = direction === 0 ? this.today : addDays(this.start, AGENDA_DAYS * direction);
    this.load();
  }

  private handleNavSelect(id: string): void {
    if (id === CALENDAR_NAV_ID) {
      return;
    }
    if (id === HOME_NAV_ID) {
      popRoute(getNavStack());
      return;
    }
    const params: LibraryRouteParams = { kind: id };
    replaceRoute(getNavStack(), ROUTES.Library, params);
  }

  private openEntry(entry: CalendarEntry): void {
    if (entry.work_id === undefined || entry.work_id === null) {
      return;
    }
    const params: DetailRouteParams = { workId: entry.work_id };
    pushRoute(getNavStack(), ROUTES.Detail, params);
  }

  @Builder
  private statusPill(tone: EntryPillTone): void {
    Text(pillLabel(tone))
      .fontSize(tv(PILL_SIZE))
      .fontWeight(FontWeight.Bold)
      .fontColor(toResourceColor(activeColors().ink))
      .height(tv(PILL_HEIGHT))
      .padding({ left: tv(PILL_PADDING_H), right: tv(PILL_PADDING_H) })
      .borderRadius(tv(PILL_HEIGHT / 2))
      .backgroundColor(pillToneFill(tone))
      .border({ width: 1, color: pillToneColor(tone) })
  }

  @Builder
  private entryCard(entry: CalendarEntry): void {
    Row({ space: tv(POSTER_GAP) }) {
      Image(entry.poster_url !== undefined && entry.poster_url !== null ? entry.poster_url : '')
        .width(tv(POSTER_WIDTH))
        .height(tv(POSTER_HEIGHT))
        .borderRadius(tv(POSTER_RADIUS))
        .objectFit(ImageFit.Cover)
        .backgroundColor(toResourceColor(activeColors().surfaceSoft))
      Column() {
        Text(entry.title)
          .fontSize(tv(ENTRY_TITLE_SIZE))
          .fontWeight(FontWeight.Medium)
          .fontColor(toResourceColor(activeColors().ink))
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
        Text(entrySubtitle(entry))
          .fontSize(tv(ENTRY_TITLE_SIZE))
          .fontColor(toResourceColor(activeColors().inkSoft))
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
        Row({ space: tv(ENTRY_META_GAP) }) {
          Text(entryTimeLabel(entry)).fontSize(tv(ENTRY_META_SIZE)).fontColor(toResourceColor(activeColors().inkMuted))
          Text(releaseTypeLabel(entry.release_type)).fontSize(tv(ENTRY_META_SIZE)).fontColor(toResourceColor(activeColors().inkMuted))
          Text(mediaKindLabel(entry.media_kind)).fontSize(tv(ENTRY_META_SIZE)).fontColor(toResourceColor(activeColors().inkMuted))
          this.statusPill(entryPillTone(entry, this.today))
        }
        .alignItems(VerticalAlign.Center)
      }
      .alignItems(HorizontalAlign.Start)
      .layoutWeight(1)
    }
    .width(tv(LIST_WIDTH))
    .height(tv(ENTRY_HEIGHT))
    .padding({ left: tv(ENTRY_PADDING_LEFT) })
    .borderRadius(tv(ENTRY_RADIUS))
    .backgroundColor(toResourceColor(activeColors().surfaceStrong))
    .border({
      width: { left: tv(ENTRY_EDGE), top: 1, right: 1, bottom: 1 },
      color: {
        left: entryAvailable(entry) ? SUCCESS : toResourceColor(activeColors().inkMuted),
        top: toResourceColorWithAlpha(activeColors().ink, 0.08),
        right: toResourceColorWithAlpha(activeColors().ink, 0.08),
        bottom: toResourceColorWithAlpha(activeColors().ink, 0.08),
      },
    })
    .focusable(true)
    .onFocus(() => {
      this.selected = entry;
    })
    .onClick(() => {
      this.selected = entry;
      this.openEntry(entry);
    })
  }

  @Builder
  private dayHeader(day: string): void {
    Row({ space: tv(10) }) {
      Text(dayHeading(day))
        .fontSize(tv(DAY_HEADING_SIZE))
        .fontWeight(FontWeight.Medium)
        .fontColor(toResourceColorWithAlpha(activeColors().ink, day === this.today ? 0.9 : 1))
      if (day === this.today) {
        Text('Today')
          .fontSize(tv(TODAY_TAG_SIZE))
          .fontWeight(FontWeight.Medium)
          .letterSpacing(tv(TODAY_TAG_LETTER_SPACING))
          .textCase(TextCase.UpperCase)
          .fontColor(toResourceColorWithAlpha(activeColors().ink, 0.9))
          .padding({ left: tv(8), right: tv(8), top: tv(2), bottom: tv(2) })
          .borderRadius(tv(11))
          .border({ width: 1, color: toResourceColorWithAlpha(activeColors().ink, 0.9) })
      }
    }
    .width(tv(LIST_WIDTH))
    .height(tv(DAY_HEADING_HEIGHT))
    .alignItems(VerticalAlign.Center)
    .backgroundColor(toResourceColor(activeColors().bg))
  }

  @Builder
  private agenda(): void {
    if (this.loading) {
      AsyncState({ kind: AsyncStateKind.Loading })
        .width(tv(LIST_WIDTH))
        .height('100%')
        .margin({ left: tv(LIST_INSET_LEFT) })
    } else if (this.groups.length === 0) {
      AsyncState({
        kind: this.errorMessage.length > 0 ? AsyncStateKind.Error : AsyncStateKind.Empty,
        message: this.errorMessage.length > 0 ? this.errorMessage : 'Nothing is scheduled for these 30 days.',
      })
        .width(tv(LIST_WIDTH))
        .height('100%')
        .margin({ left: tv(LIST_INSET_LEFT) })
    } else {
      List({ space: tv(DAY_GAP) }) {
        ForEach(this.groups, (group: DayGroup) => {
          ListItem() {
            Column({ space: tv(ENTRY_GAP) }) {
              this.dayHeader(group.day)
              Column({ space: tv(ENTRY_GAP) }) {
                ForEach(group.entries, (entry: CalendarEntry) => {
                  this.entryCard(entry)
                }, (entry: CalendarEntry): string => entry.id)
              }
              .margin({ top: tv(DAY_HEADING_GAP - ENTRY_GAP) })
            }
            .alignItems(HorizontalAlign.Start)
          }
        }, (group: DayGroup): string => group.day)
      }
      .width(tv(LIST_WIDTH))
      .height('100%')
      .padding({ top: tv(LIST_TOP), bottom: tv(LIST_TOP) })
      .margin({ left: tv(LIST_INSET_LEFT) })
      .scrollBar(BarState.Off)
      .edgeEffect(EdgeEffect.None)
    }
  }

  @Builder
  private panelExtras(): void {
    if (this.selected !== undefined) {
      Column({ space: tv(PANEL_GAP) }) {
        this.statusPill(entryPillTone(this.selected, this.today))
        if (this.selected.overview !== undefined && this.selected.overview !== null) {
          Text(this.selected.overview)
            .fontSize(tv(OVERVIEW_SIZE))
            .fontWeight(FontWeight.Medium)
            .lineHeight(tv(OVERVIEW_LINE_HEIGHT))
            .fontColor(toResourceColorWithAlpha(activeColors().ink, 0.87))
            .constraintSize({ maxWidth: tv(OVERVIEW_WIDTH) })
            .maxLines(OVERVIEW_MAX_LINES)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
        }
      }
      .alignItems(HorizontalAlign.Start)
      .margin({ top: tv(PANEL_GAP) })
    }
  }

  @Builder
  private headerControl(label: string, round: boolean, onTap: () => void): void {
    Text(label)
      .fontSize(tv(HEADER_CONTROL_FONT))
      .fontWeight(FontWeight.Bold)
      .fontColor(toResourceColor(activeColors().inkSoft))
      .textAlign(TextAlign.Center)
      .height(tv(HEADER_CONTROL_SIZE))
      .constraintSize({ minWidth: tv(HEADER_CONTROL_SIZE) })
      .padding({ left: round ? 0 : tv(20), right: round ? 0 : tv(20) })
      .borderRadius(tv(HEADER_CONTROL_SIZE / 2))
      .backgroundColor(toResourceColor(activeColors().bg))
      .border({ width: 1, color: toResourceColorWithAlpha(activeColors().ink, 0.08) })
      .focusable(true)
      .onClick(() => {
        onTap();
      })
  }

  build() {
    NavDestination() {
      Stack() {
        Stage({
          keyArt: '',
          kicker: this.selected !== undefined ?
            `${mediaKindLabel(this.selected.media_kind)} · ${releaseTypeLabel(this.selected.release_type)}` : '',
          title: this.selected !== undefined ? this.selected.title : '',
          metaLines: this.selected !== undefined ?
            [`${entrySubtitle(this.selected)}    ${entryWhenLabel(this.selected)}`] : [],
          synopsis: '',
          scrollRails: false,
          railsSlot: (): void => {
            this.agenda();
          },
          heroExtraSlot: (): void => {
            this.panelExtras();
          },
        })
        if (this.navItems.length > 0) {
          NavRail({
            items: this.navItems,
            secondaryItems: buildSecondaryNavItems(),
            selectedId: CALENDAR_NAV_ID,
            onSelect: (id: string): void => {
              this.handleNavSelect(id);
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
            .width(tv(HEADER_CONTROL_SIZE))
            .height(tv(HEADER_CONTROL_SIZE))
            .borderRadius(tv(HEADER_CONTROL_SIZE / 2))
            .backgroundColor(toResourceColorWithAlpha(activeColors().surfaceStrong, 0.7))
            .focusable(true)
            .onClick(() => {
              popRoute(getNavStack());
            })
          Text('Calendar')
            .fontSize(tv(TITLE_SIZE))
            .fontWeight(FontWeight.Medium)
            .letterSpacing(tv(TITLE_LETTER_SPACING))
            .fontColor(toResourceColor(activeColors().ink))
        }
        .height(tv(HEADER_CONTROL_SIZE))
        .alignItems(VerticalAlign.Center)
        .position({ x: tv(TvGeometry.titlePanelLeft), y: tv(TvGeometry.utilityRowTop) })
        Row({ space: tv(HEADER_CONTROL_GAP) }) {
          this.headerControl(agendaRangeLabel(this.start), false, (): void => {})
          this.headerControl('←', true, (): void => {
            this.page(-1);
          })
          this.headerControl('Today', false, (): void => {
            this.page(0);
          })
          this.headerControl('→', true, (): void => {
            this.page(1);
          })
        }
        .position({ x: tv(HEADER_RIGHT), y: tv(TvGeometry.utilityRowTop) })
        .markAnchor({ x: '100%', y: 0 })
      }
      .width('100%')
      .height('100%')
      .backgroundColor(toResourceColor(activeColors().bg))
    }
    .hideTitleBar(true)
  }
}

/** Registered in `profile/router_map.json` as the `Calendar` route's `buildFunction`. */
@Builder
export function CalendarBuilder(): void {
  Calendar()
}
