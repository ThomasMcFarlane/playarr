/**
 * The kicker / hero title / meta / synopsis text block shared by the TV
 * home Stage hero (`design/components/Stage.ets`) and the TV Detail page
 * (a later slice places it there too -- see the brief's own directory
 * tree, section 2.5: "FeatureCopy.ets -- Kicker / title / meta / synopsis
 * block used by Stage and Detail").
 *
 * This is a TV-profile component (brief section 5.4's typography table
 * only gives TV-column sizes for the roles below; the touch-profile
 * figures quoted alongside them in the brief belong to a differently
 * composed touch Detail layout that is out of scope here, same as
 * `design/components/PlayarrLogo.ets`'s TV-sized default and
 * `design/components/NavRail.ets`/`NavPill.ets` being separate,
 * profile-exclusive components rather than one universal component
 * branching internally). Every size below is therefore run through
 * `design/Metrics.ets`'s `tv()` scaling helper.
 *
 * ## Typography
 *
 * Sizes, weights, tracking, colours and gaps copy the live web TV stage copy (see the constants below);
 * web is the reference (docs/parity/README.md).
 */

import { activeColors, toResourceColor, toResourceColorWithAlpha, resolvedThemeMode } from '../Theme';
import type { ThemeModeSetting } from '../Theme';
import { tv } from '../Metrics';
import { BRAND_PINK } from '../../core/Tokens';
import type { RgbaColor } from '../../core/Tokens';

// Web TV stage copy (`.tv-provider`, `.details-panel-title`, `.tv-preview-meta`, `.tv-preview-overview`),
// measured from the live web DOM at 1920x1080.
const KICKER_FONT_SIZE: number = 12.288;
const KICKER_FONT_WEIGHT: number = 860;
const KICKER_LETTER_SPACING: number = KICKER_FONT_SIZE * 0.08;
// Dark theme kicker pink on web; light theme keeps the brand pink.
const KICKER_COLOR_DARK: RgbaColor = { r: 234, g: 166, b: 182, a: 1 };

const HERO_TITLE_FONT_SIZE: number = 69.12;
const HERO_TITLE_FONT_WEIGHT: number = 560;
const HERO_TITLE_LETTER_SPACING: number = HERO_TITLE_FONT_SIZE * -0.072;
const HERO_TITLE_LINE_HEIGHT: number = 62;
const HERO_TITLE_MAX_WIDTH: number = 373;

const COPY_TEXT_FONT_SIZE: number = 12.864;
const COPY_TEXT_FONT_WEIGHT: number = 600;
const COPY_TEXT_INK_ALPHA: number = 0.87;
const SYNOPSIS_LINE_HEIGHT: number = 20.4;
const SYNOPSIS_MAX_WIDTH: number = 324;
const SYNOPSIS_MAX_LINES: number = 5;

// Vertical gaps between kicker, title, meta and synopsis on web.
const GAP_KICKER_TITLE: number = 27;
const GAP_TITLE_META: number = 22;
const GAP_META_SYNOPSIS: number = 21;

@Component
export struct FeatureCopy {
  /** Uppercase kicker line (brand pink, `textCase` applied so the source
   * string's own casing is preserved and only the *rendering* is
   * upper-cased, matching CSS `text-transform: uppercase`). Empty string
   * hides the line entirely. */
  @Prop kicker: string = '';
  /** The work/hero title. Wraps naturally within whatever width the
   * caller (`Stage.ets`'s title panel, or later Detail's copy column)
   * gives this component -- the source CSS never line-clamps the title,
   * only `text-wrap: balance`s it, which has no ArkUI equivalent and is
   * a documented, deliberate divergence. */
  @Prop title: string = '';
  /** Short stacked meta lines (e.g. "2024 - Drama - 2h 15m", then a
   * secondary line). The LAST entry always renders in the smaller, muted
   * treatment, matching `.tv-title-meta span:last-child` -- pass a single
   * entry if there is no secondary line. Empty array hides the whole row. */
  @Prop metaLines: string[] = [];
  /** Synopsis body copy, clamped to `SYNOPSIS_MAX_LINES` lines with an
   * ellipsis. Empty string hides it entirely -- the home Stage hero
   * renders no synopsis in the source design (only Detail supplies one). */
  @Prop synopsis: string = '';

  // Tracked purely to force a re-render on theme / TV-scale change; the
  // actual values always go through design/Theme.ets's resolvers and
  // design/Metrics.ets's tv() below (see those files' own header comments
  // for this exact pattern, already used by Skeleton.ets/AsyncState.ets).
  @StorageProp('colorMode') private sysColorMode: ColorMode = ColorMode.LIGHT;
  @StorageProp('themeModeSetting') private themeSetting: ThemeModeSetting = 'system';
  @StorageProp('tvScaleFactor') private trackedTvScale: number = 1;

  private kickerColor(): string {
    return resolvedThemeMode() === 'dark' ? toResourceColor(KICKER_COLOR_DARK) : toResourceColor(BRAND_PINK);
  }

  private copyTextColor(): string {
    return toResourceColorWithAlpha(activeColors().ink, COPY_TEXT_INK_ALPHA);
  }

  build() {
    Column() {
      if (this.kicker.length > 0) {
        Text(this.kicker)
          .fontSize(tv(KICKER_FONT_SIZE))
          .fontWeight(KICKER_FONT_WEIGHT)
          .letterSpacing(tv(KICKER_LETTER_SPACING))
          .fontColor(this.kickerColor())
          .textCase(TextCase.UpperCase)
          .margin({ bottom: tv(GAP_KICKER_TITLE) })
      }

      if (this.title.length > 0) {
        Text(this.title)
          .fontSize(tv(HERO_TITLE_FONT_SIZE))
          .fontWeight(HERO_TITLE_FONT_WEIGHT)
          .letterSpacing(tv(HERO_TITLE_LETTER_SPACING))
          .lineHeight(tv(HERO_TITLE_LINE_HEIGHT))
          .constraintSize({ maxWidth: tv(HERO_TITLE_MAX_WIDTH) })
          .fontColor(toResourceColor(activeColors().ink))
      }

      if (this.metaLines.length > 0) {
        Column() {
          ForEach(
            this.metaLines,
            (line: string) => {
              Text(line)
                .fontSize(tv(COPY_TEXT_FONT_SIZE))
                .fontWeight(COPY_TEXT_FONT_WEIGHT)
                .fontColor(this.copyTextColor())
            },
            (line: string, index: number) => `${index}-${line}`
          )
        }
        .alignItems(HorizontalAlign.Start)
        .margin({ top: tv(GAP_TITLE_META) })
      }

      if (this.synopsis.length > 0) {
        Text(this.synopsis)
          .fontSize(tv(COPY_TEXT_FONT_SIZE))
          .fontWeight(COPY_TEXT_FONT_WEIGHT)
          .lineHeight(tv(SYNOPSIS_LINE_HEIGHT))
          .fontColor(this.copyTextColor())
          .constraintSize({ maxWidth: tv(SYNOPSIS_MAX_WIDTH) })
          .maxLines(SYNOPSIS_MAX_LINES)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
          .margin({ top: tv(GAP_META_SYNOPSIS) })
      }
    }
    .width('100%')
    .alignItems(HorizontalAlign.Start)
  }
}
