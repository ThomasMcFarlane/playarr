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
 * ## Typography sourcing (brief 5.4)
 *
 * `core/Tokens.ts` has no typography table (its own header comment scopes
 * it to colours, spacing/radii and the two geometry tables only), so the
 * literal sizes/weights/tracking/line-heights below are named constants
 * here, the same documented exception `design/components/Skeleton.ets`
 * (`SHIMMER_*`) and `design/components/AsyncState.ets` (`SPINNER_*`) use
 * for brief literals with no `core/Tokens.ts` field.
 *
 * - kicker: 12 / weight 820 / +0.08em tracking, brand pink, uppercase.
 *   Weight 820 rounds to `FontWeight.Bolder` per the brief's explicit
 *   guidance ("820 -> FontWeight.Bolder").
 * - hero title: 102 / weight 560 / -0.075em tracking / 0.88 line-height
 *   ratio. Weight 560 rounds to `FontWeight.Medium` ("560 ->
 *   FontWeight.Medium").
 * - title meta: 15 / weight 400 / 1.25 line-height ratio, no tracking.
 *   Renders as a short STACKED column, not an inline list -- the source
 *   CSS (`.tv-title-meta`) is `flex-direction: column`, and its own LAST
 *   line is deliberately smaller and more muted
 *   (`.tv-title-meta span:last-child { color: ink-muted; font-size:
 *   0.78em }`), reproduced below as `metaLines`'s last entry.
 * - synopsis: brief 5.4's TV column has no synopsis row at all (only the
 *   touch-profile line documents one: "synopsis 14/21 inkMuted max 5
 *   lines"). Cross-referenced instead against the shared TV rule
 *   `.tv-home-feature > p:not(.tv-provider), .tv-preview-overview,
 *   .tv-detail-synopsis` in `clients/tv-web/web/src/styles/global.css`
 *   (font-size `clamp(0.58rem, 0.67vw, 0.84rem)`, `line-height: 1.58`,
 *   `color: ink-muted`, `-webkit-line-clamp: 5`). Evaluated at the 1920px
 *   design width with the same method the rest of this table's
 *   already-brief-given TV entries agree on (hero title/kicker/title-meta
 *   all check out against it): the clamp's preferred branch (`0.67vw` @
 *   1920 = 12.864) and its upper-bound branch (`0.84rem` * 16 = 13.44)
 *   both round to the same integer, 13 -- not a guess, the one value both
 *   derivations agree on. The "5 lines" clamp matches the touch-profile
 *   figure exactly, confirming it is shared cross-platform.
 */

import { activeColors, toResourceColor } from '../Theme';
import type { ThemeModeSetting } from '../Theme';
import { tv } from '../Metrics';
import { BRAND_PINK, Spacing } from '../../core/Tokens';

/** Brief 5.4 -- kicker: 12 / 820 / +0.08em. Matches `.tv-provider,
 * .tv-detail-kicker` in global.css. */
const KICKER_FONT_SIZE: number = 12;
const KICKER_LETTER_SPACING: number = KICKER_FONT_SIZE * 0.08;

/** Brief 5.4 -- hero title: 102 / 560 / -0.075em / 0.88. Matches
 * `.tv-title-panel h1`. */
const HERO_TITLE_FONT_SIZE: number = 102;
const HERO_TITLE_LETTER_SPACING: number = HERO_TITLE_FONT_SIZE * -0.075;
const HERO_TITLE_LINE_HEIGHT: number = HERO_TITLE_FONT_SIZE * 0.88;

/** Brief 5.4 -- title meta: 15 / 400 / 1.25, no tracking. Matches
 * `.tv-title-meta` (main lines) / `.tv-title-meta span:last-child` (the
 * smaller, muted final line -- 0.78em of the 15px base). */
const TITLE_META_FONT_SIZE: number = 15;
const TITLE_META_LINE_HEIGHT: number = TITLE_META_FONT_SIZE * 1.25;
const TITLE_META_LAST_LINE_FONT_SIZE: number = TITLE_META_FONT_SIZE * 0.78;

/** Synopsis -- derived, not a brief-5.4 TV literal. See this file's header
 * comment for the derivation. */
const SYNOPSIS_FONT_SIZE: number = 13;
const SYNOPSIS_LINE_HEIGHT: number = SYNOPSIS_FONT_SIZE * 1.58;
const SYNOPSIS_MAX_LINES: number = 5;

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
  @StorageProp('colorMode') private sysColorMode: ColorMode = ColorMode.Light;
  @StorageProp('themeModeSetting') private themeSetting: ThemeModeSetting = 'system';
  @StorageProp('tvScaleFactor') private trackedTvScale: number = 1;

  build() {
    Column({ space: tv(Spacing.lg) }) {
      if (this.kicker.length > 0) {
        Text(this.kicker)
          .fontSize(tv(KICKER_FONT_SIZE))
          .fontWeight(FontWeight.Bolder)
          .letterSpacing(tv(KICKER_LETTER_SPACING))
          .fontColor(toResourceColor(BRAND_PINK))
          .textCase(TextCase.UpperCase)
      }

      if (this.title.length > 0) {
        Text(this.title)
          .fontSize(tv(HERO_TITLE_FONT_SIZE))
          .fontWeight(FontWeight.Medium)
          .letterSpacing(tv(HERO_TITLE_LETTER_SPACING))
          .lineHeight(tv(HERO_TITLE_LINE_HEIGHT))
          .fontColor(toResourceColor(activeColors().ink))
      }

      if (this.metaLines.length > 0) {
        Column() {
          ForEach(
            this.metaLines,
            (line: string, index: number) => {
              if (index === this.metaLines.length - 1) {
                Text(line)
                  .fontSize(tv(TITLE_META_LAST_LINE_FONT_SIZE))
                  .lineHeight(tv(TITLE_META_LINE_HEIGHT))
                  .fontColor(toResourceColor(activeColors().inkMuted))
              } else {
                Text(line)
                  .fontSize(tv(TITLE_META_FONT_SIZE))
                  .lineHeight(tv(TITLE_META_LINE_HEIGHT))
                  .fontColor(toResourceColor(activeColors().inkSoft))
              }
            },
            (line: string, index: number) => `${index}-${line}`
          )
        }
        .alignItems(HorizontalAlign.Start)
      }

      if (this.synopsis.length > 0) {
        Text(this.synopsis)
          .fontSize(tv(SYNOPSIS_FONT_SIZE))
          .lineHeight(tv(SYNOPSIS_LINE_HEIGHT))
          .fontColor(toResourceColor(activeColors().inkMuted))
          .maxLines(SYNOPSIS_MAX_LINES)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
      }
    }
    .width('100%')
    .alignItems(HorizontalAlign.Start)
  }
}
