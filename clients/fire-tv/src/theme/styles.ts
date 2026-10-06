/**
 * Shared `StyleSheet` fragments, named after the tv-web class they mirror
 * (design doc §4.7's closing line) so the two clients read side by side.
 *
 * Scope decision, stated explicitly because it is a deliberate narrowing of
 * what design doc §4.7 describes: this file covers only the fragments
 * genuinely reusable from THIS phase of the project -- the screen
 * container, text presets built from `typeScale`, and a focus-ring
 * fragment. It does NOT attempt `tvStageWash`/`tvKeyArt`/`tvTitlePanel`/
 * `tvMediaTrack` (the `TvStage`/`TvMediaTrack` component fragments design
 * doc §4.7 also names): those belong to `components/TvStage.tsx` and
 * `components/TvMediaTrack.tsx`, which are a later, Features-phase step,
 * out of this pass's scope entirely. Pre-guessing their exact pixel
 * proportions here -- without the component that actually consumes them in
 * front of the same author -- risks a set of style fragments nobody
 * asked for that quietly drift from what `TvStage.tsx` turns out to need,
 * which is worse than not having them yet. That component's own author
 * should harvest global.css's `.tv-key-art`/`.tv-stage-wash`/
 * `.tv-rail-panel`/`.tv-title-panel` rules directly, the same way
 * `tokens.ts`'s colours and this file's own fragments were harvested here.
 */
import {StyleSheet, type TextStyle} from 'react-native';
import {colour, focusMotion, geometry, typeScale, type TypeScaleStep} from './tokens';
import {sf, sh, sw} from './scale';

/** `typeScale`'s `fontWeight` is numeric (design-tokens is DOM/CSS-free); RN's `TextStyle.fontWeight` wants the string form. */
function fontWeight(step: TypeScaleStep): TextStyle['fontWeight'] {
  return String(step.fontWeight) as TextStyle['fontWeight'];
}

function textStyle(step: TypeScaleStep): TextStyle {
  return {
    fontSize: sf(step.fontSize),
    lineHeight: sf(step.lineHeight),
    fontWeight: fontWeight(step),
    letterSpacing: step.letterSpacing ? sf(step.letterSpacing) : undefined,
    color: colour.ink,
  };
}

/**
 * `appScreen` mirrors tv-web's page-level padding -- every screen's root
 * `<View>` uses this so content never sits under the overscan-unsafe edge
 * of the panel (react-native-safe-area-context handles the TRUE overscan
 * inset; this is the same *visual* breathing room tv-web's `--screen-x`/
 * `--screen-y` give every page regardless).
 */
export const layout = StyleSheet.create({
  appScreen: {
    flex: 1,
    backgroundColor: colour.bg,
    paddingHorizontal: sw(geometry.screenX),
    paddingVertical: sh(geometry.screenY),
  },
});

/**
 * Text presets built directly from `typeScale` -- one `TextStyle` per step,
 * so a screen writes `<Text style={text.title}>` instead of re-deriving
 * `fontSize`/`lineHeight`/`fontWeight` from the raw token every time.
 */
export const text: Record<keyof typeof typeScale, TextStyle> = {
  micro: textStyle(typeScale.micro),
  caption: textStyle(typeScale.caption),
  body: textStyle(typeScale.body),
  bodyEmphasis: textStyle(typeScale.bodyEmphasis),
  subtitle: textStyle(typeScale.subtitle),
  title: textStyle(typeScale.title),
  display: textStyle(typeScale.display),
};

/**
 * Focus-ring fragment for any custom focusable that is not a bare
 * `<Button>`/`<TouchableOpacity>` (design doc §4.4: only those two get free
 * focus feedback on Vega; everything else renders its own ring via
 * `onFocus`/`onBlur`). Spread this into a focused node's style rather than
 * re-deriving the ring colour/width by hand at each call site.
 */
export const focusRing = StyleSheet.create({
  ring: {
    borderColor: colour.focusRing,
    borderWidth: 3,
    borderRadius: 6,
  },
});

/** `focusMotion`'s scale factor, as the `transform` array `Animated.timing` output plugs straight into. */
export function focusScaleTransform(scale: number): Array<{scale: number}> {
  return [{scale}];
}

export {focusMotion};
