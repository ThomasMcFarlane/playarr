/**
 * The circular gradient profile avatar (brief 5.11, component tree:
 * "Circular gradient avatar with preset illustration, focus ring/scale").
 *
 * `presetId` is a plain string the CALLER resolves ahead of time via
 * `core/AvatarPreset.ts`'s `resolveAvatarPreset(userId)` -- this component
 * never hashes a user id itself, it only ever looks the resolved id up in
 * `core/Tokens.ts`'s `AvatarPresets` table for the gradient stops.
 *
 * ## Rendering (brief 5.11)
 *
 * "circle, `radial-gradient(circle at 34% 26%, rgba(255,255,255,0.28),
 * transparent 27%)` over `linear-gradient(145deg, start, end)`, foreground
 * `rgba(255,255,255,0.94)`, inner illustration at 84% of the circle."
 *
 * ArkUI has no single attribute that layers two different gradient types
 * on one fill, so this is built as a `Stack` of two same-size layers (a
 * `linearGradient()` base, then a `radialGradient()` highlight on top) --
 * the standard ArkUI way to composite multiple gradient fills, mirroring
 * how CSS's comma-separated multi-background layers would otherwise stack.
 * The radial layer's `radius` is a decorative-highlight approximation: CSS
 * `radial-gradient(circle at 34% 26%, ...)` with no explicit sizing keyword
 * defaults to `farthest-corner` (here, close to the full circle diameter
 * for a center this near the middle), so `this.diameter` is used directly
 * as ArkUI's `radius` and the brief's `27%` stop is kept as a fraction of
 * that same radius -- the four literal design values that matter (`34%`,
 * `26%`, `0.28`, `27%`) are preserved exactly; only the CSS-box-sizing ->
 * ArkUI-radius conversion is an approximation, documented here rather than
 * silently guessed.
 *
 * The `rgba(255,255,255,·)` highlight colour have no matching
 * `core/Tokens.ts` `ColorTokens` entry (no role is "pure white, alpha
 * varies") -- the same documented exception `design/components/Skeleton.ets`
 * already establishes for its own `rgba(255,255,255,·)` shimmer highlight.
 *
 * The inner illustration is `media/avatar_<id>.svg`, generated from web's
 * `components/ProfileAvatar.tsx` drawings (web is the reference).
 *
 * ## Focus treatment (brief 5.8)
 *
 * "profile avatar | ring opacity → 1, `scale(1.035)`" -- the ONE component
 * in this design system with a genuine focus RING (every content card
 * explicitly has none, brief 5.8's "a lift, not a ring"; the avatar's own
 * table row is the documented exception). The ring is drawn via `.border()`
 * at `activeColors().focusOutline` -- `core/Tokens.ts`'s colour role built
 * for exactly this purpose -- with its alpha animated from `0` at rest to
 * `1` at full focus. `FOCUS_LIFT.profileAvatar` has no `translateY` (it
 * only ever scales in place, like the primary play action), so only
 * `.scale(...)` is applied alongside the ring. Per `FocusLift.ets`'s own
 * header comment, the profile avatar is explicitly never rail-scoped, so
 * `activeRailFactor` is always `DEFAULT_ACTIVE_RAIL_FACTOR` here -- not a
 * caller-supplied prop, unlike `PosterCard.ets`.
 */

import { activeColors, toResourceColor, toResourceColorWithAlpha } from '../Theme';
import type { ThemeModeSetting } from '../Theme';
import { INTERACTION_CURVE, INTERACTION_CARD_MS } from '../Motion';
import { AvatarPresets, Radii } from '../../core/Tokens';
import type { AvatarPreset } from '../../core/Tokens';
import { FOCUS_LIFT, effectiveFocusPercent, DEFAULT_ACTIVE_RAIL_FACTOR } from './FocusLift';

/** Brief 5.11 gradient recipe literals -- see this file's header comment
 * for why these (and not a `core/Tokens.ts` field) are the source. */
const GRADIENT_ANGLE_DEG: number = 145;
const HIGHLIGHT_CENTER_X_PCT: string = '34%';
const HIGHLIGHT_CENTER_Y_PCT: string = '26%';
const HIGHLIGHT_ALPHA: number = 0.28;
const HIGHLIGHT_STOP: number = 0.27;

/** Brief 5.11: "inner illustration at 84% of the circle". */
const ILLUSTRATION_SLOT_RATIO: number = 0.84;


/** Brief 5.8's focus ring stroke width. No matching `core/Tokens.ts` field
 * (there is no border-width table) -- same documented-exception pattern as
 * `design/components/AsyncState.ets`'s `SPINNER_BORDER_WIDTH`. */
const RING_WIDTH: number = 2;

/** No matching `core/Tokens.ts` field (there is no avatar-diameter token
 * yet) -- same documented exception as this file's other named constants.
 * 64vp is a reasonable default profile-avatar size; every real call site
 * (the profiles picker, a nav-rail account tile) is expected to pass its
 * own explicit `diameter`, the same "TV/common default, caller overrides"
 * idiom `PlayarrLogo.ets` and `PosterCard.ets` already establish. */
const DEFAULT_AVATAR_DIAMETER: number = 64;

/** Looks up a preset by id, falling back to the first preset (`astronaut`,
 * matching `core/AvatarPreset.ts`'s own fallback ordering) if `presetId`
 * does not match any entry -- e.g. before the caller has resolved one. */
/** Web `ProfileAvatar.tsx`'s per-preset drawing (`media/avatar_<id>.svg`); astronaut for an unknown id. */
function avatarArt(presetId: string): Resource {
  switch (presetId) {
    case 'cat':
      return $r('app.media.avatar_cat');
    case 'dinosaur':
      return $r('app.media.avatar_dinosaur');
    case 'robot':
      return $r('app.media.avatar_robot');
    case 'pirate':
      return $r('app.media.avatar_pirate');
    case 'alien':
      return $r('app.media.avatar_alien');
    default:
      return $r('app.media.avatar_astronaut');
  }
}

function resolvePreset(presetId: string): AvatarPreset {
  const found = AvatarPresets.find((preset: AvatarPreset) => preset.id === presetId);
  if (found !== undefined) {
    return found;
  }
  return AvatarPresets[0];
}

@Component
export struct ProfileAvatar {
  /** Resolved ahead of time by `core/AvatarPreset.ts`'s
   * `resolveAvatarPreset(userId)`. Defaults to the first preset id so the
   * component renders something reasonable even before a real user id is
   * available. */
  @Prop presetId: string = 'astronaut';

  /** Circle diameter in vp. See `DEFAULT_AVATAR_DIAMETER` above. */
  @Prop diameter: number = DEFAULT_AVATAR_DIAMETER;

  /** Called when the avatar is activated (D-pad OK / Enter / tap). Plain
   * (non-reactive) callback field, same pattern as `AsyncState.ets`'s
   * `retry` / `PosterCard.ets`'s `onSelect`. */
  onSelect: () => void = () => {};

  // Tracked purely to force a re-render when the theme changes; the actual
  // colour decision always goes through design/Theme.ets's own resolver
  // functions (see that file's header comment for this pattern).
  @StorageProp('colorMode') private sysColorMode: ColorMode = ColorMode.LIGHT;
  @StorageProp('themeModeSetting') private themeSetting: ThemeModeSetting = 'system';

  @State private focusPercent: number = 0;

  private preset(): AvatarPreset {
    return resolvePreset(this.presetId);
  }


  private setFocused(focused: boolean): void {
    this.getUIContext().animateTo({ duration: INTERACTION_CARD_MS, curve: INTERACTION_CURVE }, () => {
      this.focusPercent = focused ? 1 : 0;
    });
  }

  /** Never rail-scoped (brief 5.8 / `FocusLift.ets` header comment) --
   * always passes the no-op multiplier, unlike `PosterCard.ets`. */
  private effective(): number {
    return effectiveFocusPercent(this.focusPercent, DEFAULT_ACTIVE_RAIL_FACTOR);
  }

  private avatarScale(): number {
    return 1 + (FOCUS_LIFT.profileAvatar.scale - 1) * this.effective();
  }

  /** "ring opacity → 1" -- rest is fully transparent (`0`), focus is fully
   * opaque (`1`), animated linearly by the same focus progress. */
  private ringOpacity(): number {
    return this.effective();
  }

  build() {

    Stack() {
      // Base: linear-gradient(145deg, start, end).
      Column()
        .width('100%')
        .height('100%')
        .linearGradient({
          angle: GRADIENT_ANGLE_DEG,
          colors: [
            [toResourceColor({ r: (this.preset().gradientStart).r, g: (this.preset().gradientStart).g, b: (this.preset().gradientStart).b, a: 1 }), 0],
            [toResourceColor({ r: (this.preset().gradientEnd).r, g: (this.preset().gradientEnd).g, b: (this.preset().gradientEnd).b, a: 1 }), 1],
          ],
        })

      // Overlay: radial-gradient(circle at 34% 26%, white@0.28, transparent 27%).
      Column()
        .width('100%')
        .height('100%')
        .radialGradient({
          center: [HIGHLIGHT_CENTER_X_PCT, HIGHLIGHT_CENTER_Y_PCT],
          radius: this.diameter,
          colors: [
            [toResourceColor({ r: 255, g: 255, b: 255, a: HIGHLIGHT_ALPHA }), 0],
            [toResourceColor({ r: 255, g: 255, b: 255, a: 0 }), HIGHLIGHT_STOP],
          ],
        })

      // Inner illustration slot at 84% of the circle -- a plain coloured
      // The preset's illustration, generated from web's `ProfileAvatar.tsx`.
      Stack() {
        Image(avatarArt(this.presetId))
          .width('100%')
          .height('100%')
      }
      .width((this.diameter * ILLUSTRATION_SLOT_RATIO))
      .height((this.diameter * ILLUSTRATION_SLOT_RATIO))
    }
    .width(this.diameter)
    .height(this.diameter)
    .borderRadius(Radii.circleFull)
    .clip(true)
    .border({
      width: RING_WIDTH,
      color: toResourceColorWithAlpha(activeColors().focusOutline, this.ringOpacity()),
      radius: Radii.circleFull,
    })
    .scale({ x: this.avatarScale(), y: this.avatarScale() })
    .focusable(true)
    .onFocus(() => {
      this.setFocused(true);
    })
    .onBlur(() => {
      this.setFocused(false);
    })
    .onClick(() => {
      this.onSelect();
    })
  }
}
