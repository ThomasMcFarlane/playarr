/**
 * WARNING -- DEBUG-ONLY PAGE. DO NOT SHIP IN A RELEASE BUILD.
 *
 * This page exists purely so a developer holding a real phone/tablet/TV can
 * see every `design/` component rendered at once, instead of hunting for a
 * live call site in the (still partial) navigation shell. It has no product
 * purpose and must be dropped from the release page list -- removing its
 * row from `profile/main_pages.json` and `profile/router_map.json` (and
 * deleting this file) -- before a real release build ships. That removal is
 * a later CI/build-config slice's job, not this one's; this slice only adds
 * the page and wires it into both manifests the same way every other page
 * is wired in, for the offline validator's page/route-integrity check
 * (`checks/manifests.mjs`) to pass.
 *
 * ## Why light/dark is a TOGGLE, but TV/touch are simultaneous SECTIONS
 *
 * `design/Theme.ets` deliberately has no per-instance theme override -- every
 * component reads the CURRENT resolved theme through one shared
 * `activeColors()` singleton (see that file's own header comment). There is
 * therefore no way to render two `PosterCard`s side by side in different
 * themes; the only theme-correct way to review both is to flip the app's
 * real theme override (via `setThemeModeSetting`, the same mechanism a real
 * Settings screen would use) and look at the same gallery again. The
 * control row at the top of this page does exactly that -- for the token
 * table below it, both palettes ARE shown side by side, but that section
 * reads `LightColors`/`DarkColors` directly rather than through any live
 * component, precisely because it does not depend on the singleton.
 *
 * `design/Metrics.ets`, by contrast, has no such restriction: every
 * TV-profile component accepts explicit `width`/`height`/`itemGap`/
 * `headingSize` overrides sourced from `TvGeometry`/`TouchGeometry`
 * directly (see `PosterCard.ets`'s and `MediaRail.ets`'s own header
 * comments -- "every other placement is expected to pass explicit
 * width/height ... via design/Metrics.ets"). So this page renders a real
 * "TV scale" row/section and a real "Touch scale" row/section
 * SIMULTANEOUSLY, side by side, without ever touching the live
 * `deviceProfile`/`tvScaleFactor` AppStorage keys that
 * `device/DeviceProfileService.ets` publishes from the actual hardware --
 * doing that from a debug page would corrupt the rest of the app's layout
 * the moment a developer navigated away without resetting it.
 *
 * `Theme.ets`/`Metrics.ets`/`Motion.ets`/`design/components/FocusLift.ets`
 * are plain data/logic modules, not `@Component`s -- they have no `build()`
 * of their own to instantiate. Their "rendering" below is: (1) the live
 * theme-toggle control, (2) a live metrics readout plus a TV-vs-touch
 * comparison table, and (3) compact reference tables listing their real
 * exported values (never re-typed literals) -- while their actual VISUAL
 * effect is already on display throughout every interactive component below
 * (a focused `PosterCard`/`ProfileAvatar`/`NavRail` tile/`AsyncState` retry
 * button IS `FocusLift`+`Motion` in action).
 */

import type { DeviceProfile } from '../core/DeviceProfile';
import {
  activeColors,
  toResourceColor,
  resolvedThemeMode,
  getThemeModeSetting,
  setThemeModeSetting,
} from '../design/Theme';
import type { ThemeModeSetting } from '../design/Theme';
import { tv, activeMetricsKey, tvScaleFactor, TvGeometry, TouchGeometry } from '../design/Metrics';
import {
  ENTRY_KEY_ART_MS,
  ENTRY_COPY_MS,
  ENTRY_COPY_DELAY_MS,
  ENTRY_PRIMARY_ACTION_MS,
  ENTRY_PRIMARY_ACTION_DELAY_MS,
  ENTRY_RAILS_MS,
  ENTRY_RAILS_DELAY_MS,
  DRAWER_MS,
  INTERACTION_CARD_MS,
  INTERACTION_TITLE_CARD_MS,
  INTERACTION_NAV_EXPAND_MS,
  FADE_OPACITY_MS,
  FADE_COLOR_MS,
  FADE_SHADOW_MS,
  SPINNER_ROTATION_MS,
  SKELETON_SHIMMER_MS,
} from '../design/Motion';
import { FOCUS_LIFT } from '../design/components/FocusLift';
import type { FocusLiftDelta } from '../design/components/FocusLift';
import { PlayarrLogo } from '../design/components/PlayarrLogo';
import { Skeleton } from '../design/components/Skeleton';
import { AsyncState, AsyncStateKind } from '../design/components/AsyncState';
import { PosterCard } from '../design/components/PosterCard';
import { ProfileAvatar } from '../design/components/ProfileAvatar';
import { MediaRail } from '../design/components/MediaRail';
import type { MediaRailItem } from '../design/components/MediaRail';
import { NavRail } from '../design/components/NavRail';
import type { NavRailItem } from '../design/components/NavRail';
import { NavPill } from '../design/components/NavPill';
import type { NavPillItem } from '../design/components/NavPill';
import { Stage } from '../design/components/Stage';
import { FeatureCopy } from '../design/components/FeatureCopy';
import { LightColors, DarkColors, BRAND_PINK, Spacing, Radii, AvatarPresets, Motion as MotionTokens } from '../core/Tokens';
import type { RgbaColor, AvatarPreset } from '../core/Tokens';

/** Gallery-chrome-only typography (section headers, labels, reference
 * tables). NOT part of the shipped design system -- `core/Tokens.ts` has no
 * typography table at all (see `design/components/FeatureCopy.ets`'s own
 * header comment on that), and even if it did, none of these numbers would
 * belong there: they style this debug page's own scaffolding, never a
 * real Playarr surface. Named here rather than inline, matching every
 * sibling file's own "no magic numbers" convention. */
const GALLERY_TITLE_FONT_SIZE: number = 24;
const GALLERY_SECTION_FONT_SIZE: number = 20;
const GALLERY_LABEL_FONT_SIZE: number = 14;
const GALLERY_BODY_FONT_SIZE: number = 13;
const GALLERY_CAPTION_FONT_SIZE: number = 12;

/** Gallery-only demo data -- ids only, `MediaRail` never reads anything
 * else from its items (see that file's own header comment). Reused by the
 * standalone TV/touch `MediaRail` sections and by the `Stage` rails slot
 * demo, below. */
const GALLERY_RAIL_ITEMS: MediaRailItem[] = [
  { id: 'gallery-item-1' },
  { id: 'gallery-item-2' },
  { id: 'gallery-item-3' },
  { id: 'gallery-item-4' },
];

/** Gallery-only demo nav items. There is no real per-icon media asset
 * shipped yet (only `playarr_logo.svg` exists under `resources/base/media`
 * today), so every tile reuses the brand mark as its icon -- the same
 * documented placeholder choice `NavRail.ets`/`NavPill.ets` already make for
 * their own internal default items. */
const GALLERY_NAV_RAIL_ITEMS: NavRailItem[] = [
  { id: 'home', icon: $r('app.media.playarr_logo'), label: 'Home' },
  { id: 'search', icon: $r('app.media.playarr_logo'), label: 'Search' },
  { id: 'series', icon: $r('app.media.playarr_logo'), label: 'Series' },
];

const GALLERY_NAV_PILL_ITEMS: NavPillItem[] = [
  { id: 'home', icon: $r('app.media.playarr_logo') },
  { id: 'search', icon: $r('app.media.playarr_logo') },
  { id: 'series', icon: $r('app.media.playarr_logo') },
];

/** Gallery-only UI constant -- no `core/Tokens.ts` field fits "a colour
 * swatch's own size", so this is derived from `Spacing.xxl` rather than a
 * freshly re-typed magic number, the same "reuse a token where one is
 * reasonably close" instinct the rest of this file follows throughout. */
const COLOR_SWATCH_SIZE: number = Spacing.xxl;

@Entry
@Component
struct DesignGallery {
  // Tracked purely to force a re-render on theme / device-profile / TV-scale
  // change; the actual values always go through design/Theme.ets's and
  // design/Metrics.ets's own resolver functions (see those files' header
  // comments for this exact pattern, already used by every component below).
  @StorageProp('colorMode') private sysColorMode: ColorMode = ColorMode.Light;
  @StorageProp('themeModeSetting') private themeSetting: ThemeModeSetting = 'system';
  @StorageProp('deviceProfile') private trackedDeviceProfile: DeviceProfile | undefined = undefined;
  @StorageProp('tvScaleFactor') private trackedTvScaleFactor: number = 1;

  @Builder
  private sectionHeader(title: string): void {
    Text(title)
      .fontSize(GALLERY_SECTION_FONT_SIZE)
      .fontWeight(FontWeight.Bold)
      .fontColor(toResourceColor(activeColors().ink))
      .margin({ top: Spacing.xl, bottom: Spacing.sm })
  }

  @Builder
  private subLabel(text: string): void {
    Text(text)
      .fontSize(GALLERY_LABEL_FONT_SIZE)
      .fontWeight(FontWeight.Medium)
      .fontColor(toResourceColor(activeColors().inkSoft))
      .margin({ top: Spacing.sm, bottom: Spacing.xs })
  }

  @Builder
  private colorSwatchRow(label: string, light: RgbaColor, dark: RgbaColor): void {
    Row({ space: Spacing.sm }) {
      Column()
        .width(COLOR_SWATCH_SIZE)
        .height(COLOR_SWATCH_SIZE)
        .borderRadius(Radii.gridCardHitArea)
        .backgroundColor(toResourceColor(light))
        .border({ width: 1, color: toResourceColor(LightColors.lineStrong) })

      Column()
        .width(COLOR_SWATCH_SIZE)
        .height(COLOR_SWATCH_SIZE)
        .borderRadius(Radii.gridCardHitArea)
        .backgroundColor(toResourceColor(dark))
        .border({ width: 1, color: toResourceColor(DarkColors.lineStrong) })

      Text(label)
        .fontSize(GALLERY_BODY_FONT_SIZE)
        .fontColor(toResourceColor(activeColors().ink))
    }
    .alignItems(VerticalAlign.Center)
  }

  @Builder
  private metricsCompareRow(label: string, tvValue: number, touchValue: number): void {
    Row({ space: Spacing.sm }) {
      Text(label)
        .fontSize(GALLERY_BODY_FONT_SIZE)
        .fontColor(toResourceColor(activeColors().ink))
        .width(200)
      Text(`TV ${tvValue}`)
        .fontSize(GALLERY_CAPTION_FONT_SIZE)
        .fontColor(toResourceColor(activeColors().inkSoft))
      Text(`Touch ${touchValue}`)
        .fontSize(GALLERY_CAPTION_FONT_SIZE)
        .fontColor(toResourceColor(activeColors().inkSoft))
    }
    .alignItems(VerticalAlign.Center)
  }

  @Builder
  private motionRow(label: string, ms: number): void {
    Row({ space: Spacing.sm }) {
      Text(label)
        .fontSize(GALLERY_BODY_FONT_SIZE)
        .fontColor(toResourceColor(activeColors().ink))
        .width(220)
      Text(`${ms}ms`)
        .fontSize(GALLERY_CAPTION_FONT_SIZE)
        .fontColor(toResourceColor(activeColors().inkSoft))
    }
    .alignItems(VerticalAlign.Center)
  }

  @Builder
  private focusLiftRow(label: string, delta: FocusLiftDelta): void {
    const dy = delta.translateY ?? 0;
    const scale = delta.scale;
    Row({ space: Spacing.sm }) {
      Text(label)
        .fontSize(GALLERY_BODY_FONT_SIZE)
        .fontColor(toResourceColor(activeColors().ink))
        .width(200)
      Text(`translateY ${dy}`)
        .fontSize(GALLERY_CAPTION_FONT_SIZE)
        .fontColor(toResourceColor(activeColors().inkSoft))
      Text(`scale ${scale}`)
        .fontSize(GALLERY_CAPTION_FONT_SIZE)
        .fontColor(toResourceColor(activeColors().inkSoft))
    }
    .alignItems(VerticalAlign.Center)
  }

  /** `MediaRail` item content at TV scale -- the "every other placement
   * passes explicit width/height" default case simply omitted, since the
   * TV-profile default already IS `tv(TvGeometry.homeRailCardWidthLandscape)`
   * (see `PosterCard.ets`'s own header comment). */
  @Builder
  private tvRailItem(item: MediaRailItem, index: number, activeRailFactor: number): void {
    const cardTitle = `Rail item ${index + 1}`;
    PosterCard({
      variant: 'home',
      title: cardTitle,
      subtitle: item.id,
      activeRailFactor: activeRailFactor,
    })
  }

  /** `MediaRail` item content at touch scale -- explicit `TouchGeometry`
   * sizing plus brief 5.4's documented touch-profile title/subtitle font
   * overrides (12/10), per `PosterCard.ets`'s own header comment. */
  @Builder
  private touchRailItem(item: MediaRailItem, index: number, activeRailFactor: number): void {
    const cardTitle = `Rail item ${index + 1}`;
    PosterCard({
      variant: 'home',
      title: cardTitle,
      subtitle: item.id,
      width: TouchGeometry.homeRailCardWidthLandscape,
      height: Math.round((TouchGeometry.homeRailCardWidthLandscape * 9) / 16),
      artworkRadius: Radii.homeCardArtworkTouch,
      titleFontSize: 12,
      subtitleFontSize: 10,
      activeRailFactor: activeRailFactor,
    })
  }

  /** `Stage.ets`'s own `railsSlot` demo content -- a real `MediaRail`
   * nested inside the rail panel, exactly how a later Home-page slice would
   * compose them (`Stage.ets`'s own header comment: "Stage never imports
   * MediaRail itself... until the caller supplies real content"). */
  @Builder
  private stageRailsSlot(): void {
    const railBuilder = this.tvRailItem;
    MediaRail({
      railId: 'gallery-stage-rail',
      heading: 'More Like This',
      items: GALLERY_RAIL_ITEMS,
      itemBuilder: railBuilder,
    })
  }

  build() {
    const tvRailItemBuilder = this.tvRailItem;
    const touchRailItemBuilder = this.touchRailItem;
    const stageRailsBuilder = this.stageRailsSlot;
    const resolvedMode = resolvedThemeMode();
    const themeOverride = getThemeModeSetting();
    const metricsKey = activeMetricsKey();
    const scaleFactor = tvScaleFactor();
    const tvLandscapeWidth = tv(TvGeometry.homeRailCardWidthLandscape);
    const tvCoverWidth = tv(TvGeometry.homeRailCardWidthCover);
    const tvTitleEpisodeWidth = tv(TvGeometry.railPanelCardWidth);
    const tvLogoSize = tv(TvGeometry.logoSize);
    const touchLandscapeWidth = TouchGeometry.homeRailCardWidthLandscape;
    const touchCoverWidth = TouchGeometry.homeRailCardWidthCover;

    Scroll() {
      Column({ space: Spacing.sm }) {
        // -- Title + theme toggle -------------------------------------------
        Text($r('app.string.design_gallery_title'))
          .fontSize(GALLERY_TITLE_FONT_SIZE)
          .fontWeight(FontWeight.Bold)
          .fontColor(toResourceColor(activeColors().ink))

        Text(
          'Debug-only visual review of every design/ component, in both ' +
            'themes (toggle below) and at both the TV and touch metric scales ' +
            '(shown side by side per section). Excluded from release builds.'
        )
          .fontSize(GALLERY_BODY_FONT_SIZE)
          .fontColor(toResourceColor(activeColors().inkSoft))

        Row({ space: Spacing.sm }) {
          Button('Light')
            .fontSize(GALLERY_LABEL_FONT_SIZE)
            .backgroundColor(toResourceColor(activeColors().surfaceStrong))
            .fontColor(toResourceColor(activeColors().ink))
            .borderRadius(Radii.btn)
            .onClick(() => {
              setThemeModeSetting('light');
            })

          Button('Dark')
            .fontSize(GALLERY_LABEL_FONT_SIZE)
            .backgroundColor(toResourceColor(activeColors().surfaceStrong))
            .fontColor(toResourceColor(activeColors().ink))
            .borderRadius(Radii.btn)
            .onClick(() => {
              setThemeModeSetting('dark');
            })

          Button('System')
            .fontSize(GALLERY_LABEL_FONT_SIZE)
            .backgroundColor(toResourceColor(activeColors().surfaceStrong))
            .fontColor(toResourceColor(activeColors().ink))
            .borderRadius(Radii.btn)
            .onClick(() => {
              setThemeModeSetting('system');
            })
        }
        .margin({ top: Spacing.xs })

        Text(`Theme override: ${themeOverride} -> resolved: ${resolvedMode}`)
          .fontSize(GALLERY_CAPTION_FONT_SIZE)
          .fontColor(toResourceColor(activeColors().inkSoft))

        // -- Colour tokens (Theme.ets) -- light vs dark, side by side -------
        this.sectionHeader('Colour tokens (core/Tokens.ts, both themes)')
        this.colorSwatchRow('bg', LightColors.bg, DarkColors.bg)
        this.colorSwatchRow('surface', LightColors.surface, DarkColors.surface)
        this.colorSwatchRow('surfaceStrong', LightColors.surfaceStrong, DarkColors.surfaceStrong)
        this.colorSwatchRow('surfaceSoft', LightColors.surfaceSoft, DarkColors.surfaceSoft)
        this.colorSwatchRow('ink', LightColors.ink, DarkColors.ink)
        this.colorSwatchRow('inkSoft', LightColors.inkSoft, DarkColors.inkSoft)
        this.colorSwatchRow('inkMuted', LightColors.inkMuted, DarkColors.inkMuted)
        this.colorSwatchRow('line', LightColors.line, DarkColors.line)
        this.colorSwatchRow('lineStrong', LightColors.lineStrong, DarkColors.lineStrong)
        this.colorSwatchRow('accent', LightColors.accent, DarkColors.accent)
        this.colorSwatchRow('accentSoft', LightColors.accentSoft, DarkColors.accentSoft)
        this.colorSwatchRow('onAccent', LightColors.onAccent, DarkColors.onAccent)
        this.colorSwatchRow('danger', LightColors.danger, DarkColors.danger)
        this.colorSwatchRow('dangerSoft', LightColors.dangerSoft, DarkColors.dangerSoft)
        this.colorSwatchRow('success', LightColors.success, DarkColors.success)
        this.colorSwatchRow('focusOutline', LightColors.focusOutline, DarkColors.focusOutline)
        this.colorSwatchRow('BRAND_PINK', BRAND_PINK, BRAND_PINK)

        // -- Metrics (design/Metrics.ets) ------------------------------------
        this.sectionHeader('Metrics reference (design/Metrics.ets)')
        Text(`Live device profile metrics key: ${metricsKey}`)
          .fontSize(GALLERY_BODY_FONT_SIZE)
          .fontColor(toResourceColor(activeColors().inkSoft))
        Text(`Live TV scale factor (windowWidthVp / 1920): ${scaleFactor}`)
          .fontSize(GALLERY_BODY_FONT_SIZE)
          .fontColor(toResourceColor(activeColors().inkSoft))
        this.metricsCompareRow(
          'Home rail card (landscape)',
          TvGeometry.homeRailCardWidthLandscape,
          TouchGeometry.homeRailCardWidthLandscape
        )
        this.metricsCompareRow(
          'Home rail card (cover)',
          TvGeometry.homeRailCardWidthCover,
          TouchGeometry.homeRailCardWidthCover
        )
        this.metricsCompareRow('Rail heading size', TvGeometry.railHeadingSize, TouchGeometry.railHeadingSize)
        this.metricsCompareRow('Player auto-hide (ms)', TvGeometry.playerAutoHideMs, TouchGeometry.playerAutoHideMs)

        // -- Motion (design/Motion.ets) ---------------------------------------
        this.sectionHeader('Motion reference (design/Motion.ets)')
        Text(
          `Entry curve control points: [${MotionTokens.entryCurve[0]}, ${MotionTokens.entryCurve[1]}, ` +
            `${MotionTokens.entryCurve[2]}, ${MotionTokens.entryCurve[3]}]`
        )
          .fontSize(GALLERY_CAPTION_FONT_SIZE)
          .fontColor(toResourceColor(activeColors().inkSoft))
        Text(
          `Interaction curve control points: [${MotionTokens.interactionCurve[0]}, ` +
            `${MotionTokens.interactionCurve[1]}, ${MotionTokens.interactionCurve[2]}, ` +
            `${MotionTokens.interactionCurve[3]}]`
        )
          .fontSize(GALLERY_CAPTION_FONT_SIZE)
          .fontColor(toResourceColor(activeColors().inkSoft))
        this.motionRow('Entry -- key art', ENTRY_KEY_ART_MS)
        this.motionRow('Entry -- copy', ENTRY_COPY_MS)
        this.motionRow('Entry -- copy delay', ENTRY_COPY_DELAY_MS)
        this.motionRow('Entry -- primary action', ENTRY_PRIMARY_ACTION_MS)
        this.motionRow('Entry -- primary action delay', ENTRY_PRIMARY_ACTION_DELAY_MS)
        this.motionRow('Entry -- rails', ENTRY_RAILS_MS)
        this.motionRow('Entry -- rails delay', ENTRY_RAILS_DELAY_MS)
        this.motionRow('Drawer', DRAWER_MS)
        this.motionRow('Interaction -- card', INTERACTION_CARD_MS)
        this.motionRow('Interaction -- title card', INTERACTION_TITLE_CARD_MS)
        this.motionRow('Interaction -- nav expand', INTERACTION_NAV_EXPAND_MS)
        this.motionRow('Fade -- opacity', FADE_OPACITY_MS)
        this.motionRow('Fade -- color', FADE_COLOR_MS)
        this.motionRow('Fade -- shadow', FADE_SHADOW_MS)
        this.motionRow('Spinner rotation', SPINNER_ROTATION_MS)
        this.motionRow('Skeleton shimmer', SKELETON_SHIMMER_MS)

        // -- FocusLift (design/components/FocusLift.ets) ----------------------
        this.sectionHeader('FocusLift reference (design/components/FocusLift.ets)')
        this.focusLiftRow('Home card', FOCUS_LIFT.homeCard)
        this.focusLiftRow('Title/episode card', FOCUS_LIFT.titleEpisodeCard)
        this.focusLiftRow('Grid card', FOCUS_LIFT.gridCard)
        this.focusLiftRow('Primary play action', FOCUS_LIFT.primaryPlayAction)
        this.focusLiftRow('Button', FOCUS_LIFT.button)
        this.focusLiftRow('TV nav tile (focused)', FOCUS_LIFT.tvNavTileFocused)
        this.focusLiftRow('TV nav tile (selected)', FOCUS_LIFT.tvNavTileSelected)
        this.focusLiftRow('Rail heading', FOCUS_LIFT.railHeading)
        this.focusLiftRow('Input', FOCUS_LIFT.input)
        this.focusLiftRow('Profile avatar', FOCUS_LIFT.profileAvatar)

        // -- PlayarrLogo -------------------------------------------------------
        this.sectionHeader('PlayarrLogo')
        Row({ space: Spacing.lg }) {
          PlayarrLogo({ size: TvGeometry.logoSize })
          PlayarrLogo({ size: tvLogoSize })
          PlayarrLogo({ size: Spacing.xl })
        }
        .alignItems(VerticalAlign.Center)

        // -- Skeleton ----------------------------------------------------------
        this.sectionHeader('Skeleton')
        Row({ space: Spacing.md }) {
          Skeleton({
            width: tvLandscapeWidth,
            height: Math.round((tvLandscapeWidth * 9) / 16),
            radius: Radii.homeCardArtworkTv,
          })
          Skeleton({
            width: touchLandscapeWidth,
            height: Math.round((touchLandscapeWidth * 9) / 16),
            radius: Radii.homeCardArtworkTouch,
          })
        }

        // -- AsyncState ----------------------------------------------------------
        this.sectionHeader('AsyncState')
        Column({ space: Spacing.md }) {
          this.subLabel('Loading')
          AsyncState({ kind: AsyncStateKind.Loading })

          this.subLabel('Empty')
          AsyncState({ kind: AsyncStateKind.Empty, message: 'Nothing here yet.' })

          this.subLabel('Error')
          AsyncState({
            kind: AsyncStateKind.Error,
            message: 'Something went wrong loading this library.',
            retryLabel: 'Retry',
            retry: () => {},
          })
        }
        .width('100%')
        .alignItems(HorizontalAlign.Start)

        // -- ProfileAvatar ----------------------------------------------------------
        this.sectionHeader('ProfileAvatar (all six presets)')
        Row({ space: Spacing.md }) {
          ForEach(
            AvatarPresets,
            (preset: AvatarPreset) => {
              ProfileAvatar({ presetId: preset.id, onSelect: () => {} })
            },
            (preset: AvatarPreset): string => preset.id
          )
        }

        // -- PosterCard ----------------------------------------------------------
        this.sectionHeader('PosterCard -- TV scale')
        Row({ space: Spacing.md }) {
          PosterCard({
            variant: 'home',
            title: 'Landscape card',
            subtitle: 'TV - 16:9 - continue watching',
            progress: 0.4,
          })
          PosterCard({
            variant: 'home',
            title: 'Cover card',
            subtitle: 'TV - 2:3',
            width: tvCoverWidth,
            height: Math.round((tvCoverWidth * 3) / 2),
            artworkRadius: Radii.homeCardArtworkTv,
          })
          PosterCard({
            variant: 'titleEpisode',
            title: 'Title / episode card',
            subtitle: 'TV - title/episode',
            width: tvTitleEpisodeWidth,
            height: Math.round((tvTitleEpisodeWidth * 9) / 16),
          })
        }

        this.sectionHeader('PosterCard -- Touch scale')
        Row({ space: Spacing.md }) {
          PosterCard({
            variant: 'home',
            title: 'Landscape card',
            subtitle: 'Touch - 16:9',
            width: touchLandscapeWidth,
            height: Math.round((touchLandscapeWidth * 9) / 16),
            artworkRadius: Radii.homeCardArtworkTouch,
            titleFontSize: 12,
            subtitleFontSize: 10,
          })
          PosterCard({
            variant: 'home',
            title: 'Cover card',
            subtitle: 'Touch - 2:3',
            width: touchCoverWidth,
            height: Math.round((touchCoverWidth * 3) / 2),
            artworkRadius: Radii.homeCardArtworkTouch,
            titleFontSize: 12,
            subtitleFontSize: 10,
          })
        }

        // -- MediaRail ----------------------------------------------------------
        this.sectionHeader('MediaRail -- TV scale')
        MediaRail({
          railId: 'gallery-media-rail-tv',
          heading: 'Continue Watching',
          items: GALLERY_RAIL_ITEMS,
          itemBuilder: tvRailItemBuilder,
        })

        this.sectionHeader('MediaRail -- Touch scale')
        MediaRail({
          railId: 'gallery-media-rail-touch',
          heading: 'Continue Watching',
          items: GALLERY_RAIL_ITEMS,
          itemGap: TouchGeometry.railItemGap,
          headingSize: TouchGeometry.railHeadingSize,
          itemBuilder: touchRailItemBuilder,
        })

        // -- Stage + NavRail (TV canvas) ---------------------------------------
        this.sectionHeader('Stage + NavRail (TV canvas, 1920x1080 design ratio)')
        Stack() {
          Stage({
            kicker: 'Now Streaming',
            title: 'Feature Presentation',
            metaLines: ['2024 - Drama - 2h 15m', 'Directed by a Design System'],
            synopsis:
              'A short synopsis paragraph previewing FeatureCopy inside the Stage ' +
              'hero, clamped to five lines maximum on the TV profile so long copy ' +
              'never overruns the title panel.',
            onPlay: () => {},
            railsSlot: stageRailsBuilder,
          })
          NavRail({
            items: GALLERY_NAV_RAIL_ITEMS,
            selectedId: 'home',
            onSelect: () => {},
          })
        }
        .width('100%')
        // Mirrors brief 5.9's 1920x1080 TV design canvas so `tv()`'s live
        // `windowWidthVp / 1920` scale factor lines back up with this
        // container's own actual rendered width.
        .aspectRatio(16 / 9)
        .clip(true)
        .border({ width: 1, color: toResourceColor(activeColors().line) })

        // -- NavPill (touch canvas) ---------------------------------------------
        this.sectionHeader('NavPill (touch canvas)')
        Stack() {
          NavPill({
            items: GALLERY_NAV_PILL_ITEMS,
            selectedId: 'home',
            onSelect: () => {},
          })
        }
        .width('100%')
        .constraintSize({ minHeight: TouchGeometry.navItemHeight + TouchGeometry.navPaddingV * 2 + Spacing.xl })
        .backgroundColor(toResourceColor(activeColors().surfaceSoft))
        .borderRadius(Radii.railPanel)

        // -- FeatureCopy (standalone) ---------------------------------------------
        this.sectionHeader('FeatureCopy (standalone / Detail preview)')
        Column() {
          FeatureCopy({
            kicker: 'Detail Preview',
            title: 'A Second Feature',
            metaLines: ['2023 - Documentary - 58m', 'A muted secondary meta line'],
            synopsis:
              'FeatureCopy is shared between the Stage hero and a later Detail ' +
              'page -- this standalone instance previews it outside Stage, at the ' +
              'same TV-profile sizing.',
          })
        }
        .width(tv(TvGeometry.titlePanelWidth))
        .padding(Spacing.md)
        .backgroundColor(toResourceColor(activeColors().surface))
        .borderRadius(Radii.railPanel)
        .margin({ bottom: Spacing.xxl })
      }
      .width('100%')
      .padding(Spacing.lg)
      .alignItems(HorizontalAlign.Start)
    }
    .width('100%')
    .height('100%')
    .backgroundColor(toResourceColor(activeColors().bg))
  }
}

/**
 * Registered in `profile/router_map.json` as the `DesignGallery` route's
 * `buildFunction`, so the system router table can construct this page by
 * name without a direct static import -- same pattern as `pages/Index.ets`'s
 * own `IndexBuilder`.
 */
@Builder
export function DesignGalleryBuilder(): void {
  DesignGallery()
}
