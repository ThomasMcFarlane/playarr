/**
 * The fonts the web draws with: Nunito Sans (UI) and JetBrains Mono (monospace), embedded from `docs/parity/fonts`.
 *
 * Vega's text stack loads a font by its file name and ignores `fontWeight` for a variable TTF (every weight of a
 * variable font renders at its default, 200 for Nunito Sans), so the app ships one static instance per weight the web
 * uses (`scripts/parity/fire-tv/build-fonts.sh` writes `assets/fonts/NunitoSans-w<weight>.ttf`) and `sans(weight)`
 * returns the style that picks the file. Always draw text with `sans()`/`mono()`: a bare `fontWeight` has no effect on
 * these families.
 */
import type {TextStyle} from 'react-native';

/** The static Nunito Sans weights in `assets/fonts` (the weights the web uses, snapped to a shared set). */
export const SANS_WEIGHTS = [300, 400, 480, 560, 610, 640, 680, 720, 760, 820, 900] as const;
export const MONO_WEIGHTS = [400, 700] as const;

function nearest<T extends readonly number[]>(weights: T, weight: number): T[number] {
  let best = weights[0];
  for (const candidate of weights) {
    if (Math.abs(candidate - weight) < Math.abs(best - weight)) best = candidate;
  }
  return best;
}

/** The Nunito Sans instance closest to a CSS `font-weight` (ties go to the lighter one). */
export function sansWeight(weight: number): number {
  return nearest(SANS_WEIGHTS, weight);
}

/** `fontFamily` for Nunito Sans at a CSS weight. `fontWeight` is pinned to `normal` so the OS never synthesises bold. */
export function sans(weight: number): Pick<TextStyle, 'fontFamily' | 'fontWeight'> {
  return {fontFamily: `NunitoSans-w${sansWeight(weight)}`, fontWeight: 'normal'};
}

export function mono(weight: number): Pick<TextStyle, 'fontFamily' | 'fontWeight'> {
  return {fontFamily: `JetBrainsMono-w${nearest(MONO_WEIGHTS, weight)}`, fontWeight: 'normal'};
}

/** A CSS text run: size in CSS px, weight, letter spacing in px and line height in px, with the family set. */
export function textRun(size: number, weight: number, opts: {letterSpacing?: number; lineHeight?: number; mono?: boolean} = {}): TextStyle {
  return {
    ...(opts.mono ? mono(weight) : sans(weight)),
    fontSize: size,
    ...(opts.letterSpacing ? {letterSpacing: opts.letterSpacing} : null),
    ...(opts.lineHeight ? {lineHeight: opts.lineHeight} : null),
  };
}
