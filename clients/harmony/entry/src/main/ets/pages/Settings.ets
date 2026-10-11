/**
 * Settings workspace, TV layout (web `pages/settings/SettingsIndex.tsx` with `SettingsLayout`): "Preferences"
 * with the open section as a pink kicker, the numbered section list on the left (480x92 rows from (154, 162),
 * the open one on surface-soft) and the open section's panel on the right. Geometry copies the live web TV
 * DOM at 1920x1080. Section numbers are web's own (they are ids, not positions).
 *
 * Here so far: Appearance (colour theme, saved for the next start) and Server connection (the address in
 * use). The other web sections land with 13.10018's later steps.
 */

import { activeColors, toResourceColor, toResourceColorWithAlpha } from '../design/Theme';
import type { ThemeModeSetting } from '../design/Theme';
import { tv, TvGeometry } from '../design/Metrics';
import { NavRail } from '../design/components/NavRail';
import type { NavRailItem } from '../design/components/NavRail';
import { PlayarrLogo } from '../design/components/PlayarrLogo';
import { Clock } from '../design/components/Clock';
import { ChoiceSegments } from '../design/components/ChoiceSegments';
import type { Choice } from '../design/components/ChoiceSegments';
import { BRAND_PINK_SOFT } from '../core/Tokens';

import { getCatalogKinds } from '../data/CatalogRepository';
import { getServerDirectory, saveThemeChoice } from '../AppContainer';

import { buildNavRailItems, buildPrimaryNavItems, buildSecondaryNavItems, navigateFromRail } from '../navigation/NavItems';
import { getNavStack, popRoute } from '../navigation/NavStack';

interface SettingsSection {
  id: string;
  number: string;
  title: string;
}

const APPEARANCE: string = 'appearance';
const SERVER: string = 'server';
const SECTIONS: SettingsSection[] = [
  { id: APPEARANCE, number: '01', title: 'Appearance' },
  { id: SERVER, number: '05', title: 'Server connection' },
];
const THEME_CHOICES: Choice[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

// Web `.settings-option`: 480x92 rows from (154, 162); number at +32/+24, title at +92, arrow at +432.
const LIST_TOP: number = 162;
const ROW_WIDTH: number = 480;
const ROW_HEIGHT: number = 92;
const NUMBER_LEFT: number = 32;
const NUMBER_TOP: number = 24;
const NUMBER_SIZE: number = 9.92;
const TITLE_LEFT: number = 92;
const TITLE_SIZE: number = 29.6;
const TITLE_LETTER_SPACING: number = -1.036;
const ARROW_LEFT: number = 432;
const ARROW_SIZE: number = 20.8;
// Web `.settings-section-content`: the panel copy starts at (774, 210), 1042 wide.
const PANEL_LEFT: number = 774;
const PANEL_TOP: number = 210;
const PANEL_WIDTH: number = 1042;
const PANEL_TEXT_SIZE: number = 13.824;
// Web page header with a subtitle: back 50x50, "Preferences" 33.6 px, the kicker 12.288 px pink at y=112.
const HEADER_SIZE: number = 50;
const BACK_GLYPH_SIZE: number = 17.28;
const HEADING_SIZE: number = 33.6;
const HEADING_LETTER_SPACING: number = -1.512;
const HEADER_GAP: number = 23;
const KICKER_TOP: number = 112;
const KICKER_SIZE: number = 12.288;
const KICKER_LETTER_SPACING: number = 0.983;

@Component
export struct SettingsScreen {
  @StorageProp('colorMode') private sysColorMode: ColorMode = ColorMode.LIGHT;
  @StorageProp('themeModeSetting') private themeSetting: ThemeModeSetting = 'system';
  @StorageProp('tvScaleFactor') private trackedTvScale: number = 1;

  @State private openSection: string = APPEARANCE;
  @State private navItems: NavRailItem[] = [];

  aboutToAppear(): void {
    this.loadNav();
  }

  private async loadNav(): Promise<void> {
    const kinds = await getCatalogKinds();
    this.navItems = buildNavRailItems(kinds.kind === 'ok' ? kinds.value : []);
  }

  private sectionTitle(): string {
    const open = SECTIONS.find((section: SettingsSection) => section.id === this.openSection);
    return open !== undefined ? open.title : '';
  }

  @Builder
  private sectionRow(section: SettingsSection): void {
    Stack({ alignContent: Alignment.TopStart }) {
      Text(section.number)
        .fontSize(tv(NUMBER_SIZE))
        .fontWeight(FontWeight.Bold)
        .fontColor(toResourceColor(activeColors().ink))
        .position({ x: tv(NUMBER_LEFT), y: tv(NUMBER_TOP) })
      Text(section.title)
        .fontSize(tv(TITLE_SIZE))
        .fontWeight(FontWeight.Medium)
        .letterSpacing(tv(TITLE_LETTER_SPACING))
        .fontColor(toResourceColor(activeColors().ink))
        .height(tv(ROW_HEIGHT))
        .position({ x: tv(TITLE_LEFT), y: 0 })
      Text('→')
        .fontSize(tv(ARROW_SIZE))
        .fontColor(toResourceColor(activeColors().ink))
        .height(tv(ROW_HEIGHT))
        .position({ x: tv(ARROW_LEFT), y: 0 })
    }
    .width(tv(ROW_WIDTH))
    .height(tv(ROW_HEIGHT))
    .backgroundColor(section.id === this.openSection ? toResourceColor(activeColors().surfaceSoft) : Color.Transparent)
    .focusable(true)
    .onFocus(() => {
      this.openSection = section.id;
    })
    .onClick(() => {
      this.openSection = section.id;
    })
  }

  @Builder
  private appearancePanel(): void {
    ChoiceSegments({
      heading: 'Colour theme',
      choices: THEME_CHOICES,
      selected: this.themeSetting,
      large: true,
      width: PANEL_WIDTH,
      onChoose: (value: string) => {
        saveThemeChoice(value as ThemeModeSetting);
      },
    })
  }

  @Builder
  private serverPanel(): void {
    Column({ space: tv(16) }) {
      Text('Server connection')
        .fontSize(tv(26.4))
        .fontWeight(FontWeight.Medium)
        .letterSpacing(tv(-0.924))
        .fontColor(toResourceColor(activeColors().ink))
      Text(getServerDirectory().getActiveBaseUrl() ?? 'No server connected.')
        .fontSize(tv(PANEL_TEXT_SIZE))
        .fontColor(toResourceColor(activeColors().inkSoft))
    }
    .width(tv(PANEL_WIDTH))
    .alignItems(HorizontalAlign.Start)
  }

  build() {
    NavDestination() {
      Stack() {
        Column() {
          ForEach(SECTIONS, (section: SettingsSection) => {
            this.sectionRow(section)
          }, (section: SettingsSection): string => `${section.id}:${section.id === this.openSection}`)
        }
        .position({ x: tv(TvGeometry.titlePanelLeft), y: tv(LIST_TOP) })
        Column() {
          if (this.openSection === APPEARANCE) {
            this.appearancePanel()
          } else {
            this.serverPanel()
          }
        }
        .position({ x: tv(PANEL_LEFT), y: tv(PANEL_TOP) })
        if (this.navItems.length > 0) {
          NavRail({
            items: this.navItems,
            primaryItems: buildPrimaryNavItems(),
            secondaryItems: buildSecondaryNavItems(),
            selectedId: '',
            onSelect: (id: string): void => {
              navigateFromRail(id, '');
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
          Text('Preferences')
            .fontSize(tv(HEADING_SIZE))
            .fontWeight(FontWeight.Medium)
            .letterSpacing(tv(HEADING_LETTER_SPACING))
            .fontColor(toResourceColor(activeColors().ink))
        }
        .height(tv(HEADER_SIZE))
        .alignItems(VerticalAlign.Center)
        .position({ x: tv(TvGeometry.titlePanelLeft), y: tv(TvGeometry.utilityRowTop) })
        Text(this.sectionTitle())
          .fontSize(tv(KICKER_SIZE))
          .fontWeight(FontWeight.Bolder)
          .letterSpacing(tv(KICKER_LETTER_SPACING))
          .textCase(TextCase.UpperCase)
          .fontColor(toResourceColor(BRAND_PINK_SOFT))
          .position({ x: tv(TvGeometry.titlePanelLeft + HEADER_SIZE + HEADER_GAP), y: tv(KICKER_TOP) })
      }
      .width('100%')
      .height('100%')
      .backgroundColor(toResourceColor(activeColors().bg))
    }
    .hideTitleBar(true)
  }
}

/** Registered in `profile/router_map.json` as the `Settings` route's `buildFunction`. */
@Builder
export function SettingsBuilder(): void {
  SettingsScreen()
}
