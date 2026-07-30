/**
 * Native ArkUI folder browser embedded by `pages/Library.ets`.
 *
 * The root selector and breadcrumbs are horizontal `List` scroll
 * containers; the directory level is a vertical `List`. That preserves
 * touch/trackpad scrolling and HarmonyOS directional focus on phone,
 * tablet, and TV without focus-driven synthetic scrolling.
 *
 * Every media title, byline, technical detail, and thumbnail comes from
 * the server's file-derived folder response/media thumbnail endpoint.
 * Selecting a playable file pushes the existing `ROUTES.Player` route,
 * which negotiates playback and renders through the native AVPlayer
 * `XComponent` surface.
 */

import { image } from '@kit.ImageKit';

import { activeColors, toResourceColor } from '../design/Theme';
import type { ThemeModeSetting } from '../design/Theme';
import { tv, isTvMetrics, TvGeometry } from '../design/Metrics';
import { INTERACTION_CURVE, INTERACTION_CARD_MS } from '../design/Motion';
import {
  DEFAULT_ACTIVE_RAIL_FACTOR,
  effectiveFocusPercent,
  FOCUS_LIFT,
} from '../design/components/FocusLift';
import { AsyncState, AsyncStateKind } from '../design/components/AsyncState';
import { Radii, Spacing } from '../core/Tokens';

import {
  folderEntryKey,
  folderEntryMetadata,
  folderEntryTitle,
} from '../core/FolderPresentation';
import type { WorkKind } from '../core/Types/Catalog';
import type {
  FolderBreadcrumb,
  FolderEntry,
  FolderRoot,
  FolderRootError,
} from '../core/Types/Folders';

import { browseFolder, folderPageSize, getFolderRoots } from '../data/FolderRepository';
import { fetchMediaThumbnail } from '../data/ArtworkRepository';
import { getNavStack, pushRoute } from '../navigation/NavStack';
import { ROUTES } from '../navigation/Routes';
import type { PlayerRouteParams } from '../navigation/Routes';
import { logWarn } from '../util/Log';

const LOG_TAG: string = 'LibraryFolders';
const FOLDER_PAGINATION_LOOKAHEAD: number = 10;
const TOUCH_THUMBNAIL_WIDTH: number = 96;
const TOUCH_THUMBNAIL_HEIGHT: number = 54;
const TV_THUMBNAIL_WIDTH: number = 160;
const TV_THUMBNAIL_HEIGHT: number = 90;
const FOLDER_ROW_MIN_HEIGHT_TOUCH: number = 78;
const FOLDER_ROW_MIN_HEIGHT_TV: number = 112;

function folderRootLabel(root: FolderRoot): string {
  if (root.source_name === root.name) {
    return root.name;
  }
  return root.source_name + ' — ' + root.name;
}

function unavailableRootMessage(root: FolderRoot): string {
  const reason = root.unavailable_reason;
  if (reason !== null && reason !== undefined && reason.length > 0) {
    return reason;
  }
  return 'This root folder is not available on this device.';
}

function rootWarningsMessage(errors: FolderRootError[]): string {
  const lines: string[] = [];
  for (const error of errors) {
    lines.push(error.source_name + ': ' + error.message);
  }
  return lines.join('\n');
}

@Component
struct FolderPickerChip {
  label: string = '';
  @Prop selected: boolean = false;
  @Prop available: boolean = true;
  onActivate: () => void = () => {};

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
    const background = this.selected
      ? activeColors().accent
      : (this.available ? activeColors().surfaceSoft : activeColors().dangerSoft);
    const foreground = this.selected ? activeColors().onAccent : activeColors().ink;
    const opacity = this.available ? 1 : 0.68;
    const activate = this.onActivate;

    Text(this.label)
      .fontSize(13)
      .fontWeight(FontWeight.Medium)
      .fontColor(toResourceColor(foreground))
      .maxLines(1)
      .textOverflow({ overflow: TextOverflow.Ellipsis })
      .padding({ left: Spacing.md, right: Spacing.md, top: Spacing.xs, bottom: Spacing.xs })
      .backgroundColor(toResourceColor(background))
      .borderRadius(Radii.pillFull)
      .opacity(opacity)
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

const PLACEHOLDER_FOLDER_ENTRY: FolderEntry = {
  entry_type: 'directory',
  name: '',
  path: '',
};

@Component
struct FolderEntryRow {
  entry: FolderEntry = PLACEHOLDER_FOLDER_ENTRY;
  onActivate: (entry: FolderEntry) => void = () => {};

  @StorageProp('colorMode') private sysColorMode: ColorMode = ColorMode.Light;
  @StorageProp('themeModeSetting') private themeSetting: ThemeModeSetting = 'system';
  @State private artwork: image.PixelMap | undefined = undefined;
  @State private focusPercent: number = 0;

  aboutToAppear(): void {
    void this.loadArtwork();
  }

  private async loadArtwork(): Promise<void> {
    if (this.entry.entry_type !== 'media' ||
      this.entry.thumbnail_url === null ||
      this.entry.thumbnail_url === undefined ||
      this.entry.thumbnail_url.length === 0) {
      return;
    }
    const mediaFileId = this.entry.media_file_id;
    if (mediaFileId === null || mediaFileId === undefined || mediaFileId.length === 0) {
      return;
    }
    const result = await fetchMediaThumbnail(mediaFileId, 0);
    if (result.kind === 'ok') {
      this.artwork = result.value;
    }
  }

  private setFocused(focused: boolean): void {
    this.getUIContext().animateTo({ duration: INTERACTION_CARD_MS, curve: INTERACTION_CURVE }, () => {
      this.focusPercent = focused ? 1 : 0;
    });
  }

  build() {
    const entry = this.entry;
    const isDirectory = entry.entry_type === 'directory';
    const mediaFileId = entry.media_file_id;
    const playable = isDirectory ||
      (mediaFileId !== null && mediaFileId !== undefined && mediaFileId.length > 0);
    const width = isTvMetrics() ? tv(TV_THUMBNAIL_WIDTH) : TOUCH_THUMBNAIL_WIDTH;
    const height = isTvMetrics() ? tv(TV_THUMBNAIL_HEIGHT) : TOUCH_THUMBNAIL_HEIGHT;
    const rowHeight = isTvMetrics() ? tv(FOLDER_ROW_MIN_HEIGHT_TV) : FOLDER_ROW_MIN_HEIGHT_TOUCH;
    const title = folderEntryTitle(entry);
    const showFilename = !isDirectory && title !== entry.name;
    const metadata = folderEntryMetadata(entry);
    const artwork = this.artwork;
    const activate = this.onActivate;
    const effective = effectiveFocusPercent(this.focusPercent, DEFAULT_ACTIVE_RAIL_FACTOR);
    const scale = 1 + (FOCUS_LIFT.gridCard.scale - 1) * effective;
    const translateY = (FOCUS_LIFT.gridCard.translateY ?? 0) * effective;

    Row({ space: Spacing.md }) {
      Stack({ alignContent: Alignment.Center }) {
        if (artwork !== undefined && !isDirectory) {
          Image(artwork)
            .width(width)
            .height(height)
            .objectFit(ImageFit.Cover)
        } else {
          Column({ space: Spacing.xs }) {
            Text(isDirectory ? 'DIR' : 'MEDIA')
              .fontSize(isDirectory ? 16 : 11)
              .fontWeight(FontWeight.Bold)
              .fontColor(toResourceColor(activeColors().inkSoft))
            Text(isDirectory ? '▸' : '▶')
              .fontSize(isDirectory ? 18 : 13)
              .fontColor(toResourceColor(activeColors().accent))
          }
          .width(width)
          .height(height)
          .justifyContent(FlexAlign.Center)
          .alignItems(HorizontalAlign.Center)
          .backgroundColor(toResourceColor(activeColors().surfaceSoft))
        }
      }
      .width(width)
      .height(height)
      .borderRadius(Radii.homeCardArtworkTouch)
      .clip(true)

      Column({ space: Spacing.xs }) {
        Text(title)
          .fontSize(isTvMetrics() ? tv(TvGeometry.railHeadingSize) : 15)
          .fontWeight(FontWeight.Medium)
          .fontColor(toResourceColor(activeColors().ink))
          .maxLines(2)
          .textOverflow({ overflow: TextOverflow.Ellipsis })

        if (showFilename) {
          Text(entry.name)
            .fontSize(isTvMetrics() ? tv(11) : 9)
            .fontColor(toResourceColor(activeColors().inkSoft))
            .maxLines(1)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
        }

        Text(metadata)
          .fontSize(isTvMetrics() ? tv(13) : 11)
          .fontColor(toResourceColor(activeColors().inkMuted))
          .maxLines(2)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
      }
      .layoutWeight(1)
      .alignItems(HorizontalAlign.Start)

      Text(isDirectory ? '›' : (playable ? '▶' : '!'))
        .fontSize(isDirectory ? 24 : 14)
        .fontWeight(FontWeight.Bold)
        .fontColor(toResourceColor(playable ? activeColors().accent : activeColors().inkMuted))
    }
    .width('100%')
    .constraintSize({ minHeight: rowHeight })
    .padding({ left: Spacing.md, right: Spacing.md, top: Spacing.sm, bottom: Spacing.sm })
    .alignItems(VerticalAlign.Center)
    .backgroundColor(toResourceColor(activeColors().surfaceStrong))
    .border({ width: 1, color: toResourceColor(activeColors().line) })
    .borderRadius(Radii.gridCardHitArea)
    .opacity(playable ? 1 : 0.62)
    .focusable(playable)
    .onFocus(() => {
      this.setFocused(true);
    })
    .onBlur(() => {
      this.setFocused(false);
    })
    .translateY(translateY)
    .scale({ x: scale, y: scale })
    .onClick(() => {
      if (playable) {
        activate(entry);
      }
    })
  }
}

@Component
export struct LibraryFolders {
  @Prop kind: string = '';

  @State private roots: FolderRoot[] = [];
  @State private rootErrors: FolderRootError[] = [];
  @State private selectedRootId: string = '';
  @State private currentPath: string = '';
  @State private breadcrumbs: FolderBreadcrumb[] = [];
  @State private entries: FolderEntry[] = [];
  @State private loadingRoots: boolean = true;
  @State private loadingFolder: boolean = false;
  @State private loadingMore: boolean = false;
  @State private hasMore: boolean = false;
  @State private rootsErrorMessage: string = '';
  @State private folderErrorMessage: string = '';
  @State private loadMoreFailed: boolean = false;

  @StorageProp('colorMode') private sysColorMode: ColorMode = ColorMode.Light;
  @StorageProp('themeModeSetting') private themeSetting: ThemeModeSetting = 'system';
  @StorageProp('tvScaleFactor') private trackedTvScale: number = 1;

  private browseGeneration: number = 0;

  aboutToAppear(): void {
    void this.loadRoots();
  }

  private effectiveKind(): WorkKind {
    return this.kind as WorkKind;
  }

  private findRoot(rootId: string): FolderRoot | null {
    for (const root of this.roots) {
      if (root.id === rootId) {
        return root;
      }
    }
    return null;
  }

  private selectedRoot(): FolderRoot | null {
    return this.findRoot(this.selectedRootId);
  }

  private resetFolderState(): void {
    this.currentPath = '';
    this.breadcrumbs = [];
    this.entries = [];
    this.hasMore = false;
    this.loadingFolder = false;
    this.loadingMore = false;
    this.folderErrorMessage = '';
    this.loadMoreFailed = false;
  }

  private selectRoot(root: FolderRoot): void {
    this.browseGeneration = this.browseGeneration + 1;
    this.selectedRootId = root.id;
    this.resetFolderState();
    if (!root.available) {
      return;
    }
    this.openPath('');
  }

  private openPath(path: string): void {
    const root = this.selectedRoot();
    if (root === null || !root.available) {
      return;
    }
    this.browseGeneration = this.browseGeneration + 1;
    const generation = this.browseGeneration;
    this.currentPath = path;
    this.entries = [];
    this.breadcrumbs = [];
    this.hasMore = false;
    this.folderErrorMessage = '';
    this.loadMoreFailed = false;
    void this.loadFolderPage(0, generation);
  }

  private retryFolder(): void {
    this.openPath(this.currentPath);
  }

  private maybeLoadMore(lastVisibleIndex: number): void {
    if (!this.hasMore || this.loadingFolder || this.loadingMore) {
      return;
    }
    const remaining = this.entries.length - 1 - lastVisibleIndex;
    if (remaining > FOLDER_PAGINATION_LOOKAHEAD) {
      return;
    }
    void this.loadFolderPage(this.entries.length, this.browseGeneration);
  }

  private activateEntry(entry: FolderEntry): void {
    if (entry.entry_type === 'directory') {
      this.openPath(entry.path);
      return;
    }
    const mediaFileId = entry.media_file_id;
    if (mediaFileId === null || mediaFileId === undefined || mediaFileId.length === 0) {
      return;
    }
    const params: PlayerRouteParams = {
      mediaFileId: mediaFileId,
      title: folderEntryTitle(entry),
    };
    pushRoute(getNavStack(), ROUTES.Player, params);
  }

  private async loadRoots(): Promise<void> {
    this.loadingRoots = true;
    this.rootsErrorMessage = '';
    const result = await getFolderRoots(this.effectiveKind());
    if (result.kind === 'ok') {
      this.roots = result.value.roots;
      this.rootErrors = result.value.errors;

      let selected: FolderRoot | null = null;
      for (const root of result.value.roots) {
        if (selected === null || (!selected.available && root.available)) {
          selected = root;
        }
      }
      if (selected !== null) {
        this.selectRoot(selected);
      } else {
        this.selectedRootId = '';
        this.resetFolderState();
      }
    } else {
      let message = 'Could not load root folders. Please try again.';
      if (result.kind === 'network_failure') {
        message = result.message;
      } else if (result.kind === 'http_failure') {
        const envelope = result.envelope;
        if (envelope.kind === 'general') {
          message = envelope.message;
        } else if (envelope.kind === 'upgrade_required') {
          message = 'Update Playarr to browse folders.';
        } else if (envelope.kind === 'oauth') {
          message = 'Your session has expired. Please sign in again.';
        }
      }
      this.rootsErrorMessage = message;
      logWarn(LOG_TAG, 'folder roots fetch failed: ' + message);
    }
    this.loadingRoots = false;
  }

  private async loadFolderPage(offset: number, generation: number): Promise<void> {
    const rootId = this.selectedRootId;
    const path = this.currentPath;
    if (rootId.length === 0) {
      return;
    }

    if (offset === 0) {
      this.loadingFolder = true;
    } else {
      this.loadingMore = true;
      this.loadMoreFailed = false;
    }

    const result = await browseFolder(rootId, path, folderPageSize, offset);
    if (generation !== this.browseGeneration ||
      rootId !== this.selectedRootId ||
      path !== this.currentPath) {
      return;
    }

    if (result.kind === 'ok') {
      const response = result.value;
      const existingEntries = this.entries;
      const nextEntries: FolderEntry[] = offset === 0 ? [] : existingEntries.slice();
      for (const entry of response.entries) {
        nextEntries.push(entry);
      }
      this.entries = nextEntries;
      this.breadcrumbs = response.breadcrumbs;
      this.currentPath = response.path;
      this.hasMore = nextEntries.length < response.total && response.entries.length > 0;
      this.folderErrorMessage = '';
      this.loadMoreFailed = false;
    } else {
      let message = 'Could not open this folder. Please try again.';
      if (result.kind === 'network_failure') {
        message = result.message;
      } else if (result.kind === 'http_failure') {
        const envelope = result.envelope;
        if (envelope.kind === 'general') {
          message = envelope.message;
        } else if (envelope.kind === 'upgrade_required') {
          message = 'Update Playarr to browse folders.';
        } else if (envelope.kind === 'oauth') {
          message = 'Your session has expired. Please sign in again.';
        }
      }
      logWarn(
        LOG_TAG,
        'folder browse failed (root=' + rootId + ', path=' + path + ', offset=' + String(offset) + '): ' + message
      );
      if (offset === 0) {
        this.folderErrorMessage = message;
      } else {
        this.loadMoreFailed = true;
      }
    }

    this.loadingFolder = false;
    this.loadingMore = false;
  }

  build() {
    const roots = this.roots;
    const selectedRootId = this.selectedRootId;
    const selectedRoot = this.selectedRoot();
    const breadcrumbs = this.breadcrumbs;
    const entries = this.entries;
    const entryCount = entries.length;
    const loadingRoots = this.loadingRoots;
    const loadingFolder = this.loadingFolder;
    const loadingMore = this.loadingMore;
    const loadMoreFailed = this.loadMoreFailed;
    const rootsErrorMessage = this.rootsErrorMessage;
    const folderErrorMessage = this.folderErrorMessage;
    const warnings = rootWarningsMessage(this.rootErrors);
    const pickerHeight = isTvMetrics() ? tv(48) : 42;

    Column({ space: Spacing.sm }) {
      if (loadingRoots) {
        AsyncState({ kind: AsyncStateKind.Loading })
          .layoutWeight(1)
          .width('100%')
      } else if (roots.length === 0 && rootsErrorMessage.length > 0) {
        AsyncState({
          kind: AsyncStateKind.Error,
          message: rootsErrorMessage,
          retry: () => {
            void this.loadRoots();
          },
        })
          .layoutWeight(1)
          .width('100%')
      } else if (roots.length === 0) {
        AsyncState({
          kind: AsyncStateKind.Empty,
          message: warnings.length > 0 ? warnings : 'No root folders found for this library.',
        })
          .layoutWeight(1)
          .width('100%')
      } else {
        List({ space: Spacing.xs }) {
          ForEach(
            roots,
            (root: FolderRoot) => {
              ListItem() {
                FolderPickerChip({
                  label: folderRootLabel(root),
                  selected: root.id === selectedRootId,
                  available: root.available,
                  onActivate: () => {
                    this.selectRoot(root);
                  },
                })
              }
            },
            (root: FolderRoot): string => root.id
          )
        }
        .listDirection(Axis.Horizontal)
        .scrollBar(BarState.Auto)
        .edgeEffect(EdgeEffect.Spring)
        .height(pickerHeight)
        .width('100%')
        .padding({ left: Spacing.lg, right: Spacing.lg, top: Spacing.xs, bottom: Spacing.xs })

        if (warnings.length > 0) {
          Text(warnings)
            .fontSize(11)
            .fontColor(toResourceColor(activeColors().inkSoft))
            .maxLines(3)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
            .width('100%')
            .padding({ left: Spacing.lg, right: Spacing.lg, top: Spacing.xs, bottom: Spacing.xs })
            .backgroundColor(toResourceColor(activeColors().dangerSoft))
        }

        if (selectedRoot !== null && selectedRoot.available && breadcrumbs.length > 0) {
          List({ space: Spacing.xs }) {
            ForEach(
              breadcrumbs,
              (breadcrumb: FolderBreadcrumb, index: number) => {
                ListItem() {
                  Row({ space: Spacing.xs }) {
                    if (index > 0) {
                      Text('›')
                        .fontSize(13)
                        .fontColor(toResourceColor(activeColors().inkMuted))
                    }
                    FolderPickerChip({
                      label: breadcrumb.name,
                      selected: index === breadcrumbs.length - 1,
                      available: true,
                      onActivate: () => {
                        this.openPath(breadcrumb.path);
                      },
                    })
                  }
                }
              },
              (breadcrumb: FolderBreadcrumb): string => breadcrumb.path
            )
          }
          .listDirection(Axis.Horizontal)
          .scrollBar(BarState.Auto)
          .edgeEffect(EdgeEffect.Spring)
          .height(pickerHeight)
          .width('100%')
          .padding({ left: Spacing.lg, right: Spacing.lg, top: Spacing.xs, bottom: Spacing.xs })
        }

        if (selectedRoot !== null && !selectedRoot.available) {
          AsyncState({
            kind: AsyncStateKind.Empty,
            message: unavailableRootMessage(selectedRoot),
          })
            .layoutWeight(1)
            .width('100%')
        } else if (loadingFolder) {
          AsyncState({ kind: AsyncStateKind.Loading })
            .layoutWeight(1)
            .width('100%')
        } else if (folderErrorMessage.length > 0) {
          AsyncState({
            kind: AsyncStateKind.Error,
            message: folderErrorMessage,
            retry: () => {
              this.retryFolder();
            },
          })
            .layoutWeight(1)
            .width('100%')
        } else if (entryCount === 0) {
          AsyncState({
            kind: AsyncStateKind.Empty,
            message: 'This folder is empty.',
          })
            .layoutWeight(1)
            .width('100%')
        } else {
          if (loadingMore) {
            Row() {
              AsyncState({ kind: AsyncStateKind.Loading })
            }
            .width('100%')
            .height(32)
            .justifyContent(FlexAlign.Center)
          } else if (loadMoreFailed) {
            Text("Couldn't load more. Scroll to try again.")
              .fontSize(11)
              .fontColor(toResourceColor(activeColors().inkMuted))
              .textAlign(TextAlign.Center)
              .width('100%')
          }

          List({ space: Spacing.sm }) {
            ForEach(
              entries,
              (entry: FolderEntry) => {
                ListItem() {
                  FolderEntryRow({
                    entry: entry,
                    onActivate: (selected: FolderEntry) => {
                      this.activateEntry(selected);
                    },
                  })
                }
              },
              (entry: FolderEntry): string => folderEntryKey(entry)
            )
          }
          .scrollBar(BarState.Auto)
          .edgeEffect(EdgeEffect.Spring)
          .padding({ left: Spacing.lg, right: Spacing.lg, top: Spacing.sm, bottom: Spacing.lg })
          .onScrollIndex((_first: number, last: number) => {
            this.maybeLoadMore(last);
          })
          .onReachEnd(() => {
            this.maybeLoadMore(entryCount - 1);
          })
          .layoutWeight(1)
          .width('100%')
        }
      }
    }
    .layoutWeight(1)
    .width('100%')
    .alignItems(HorizontalAlign.Start)
  }
}
