/**
 * Scales a value authored against the 1920x1080 TV canvas
 * `theme/tokens.ts`'s `geometry` (and every screen's own layout) is
 * designed at, onto whatever `Dimensions.get('window')` actually reports on
 * this device -- Amazon's own documented idiom for a Vega app that must
 * look right on both a 1080p Stick and a 4K panel (design doc §4.7).
 *
 * Deliberately reads `Dimensions.get('window')` fresh inside each call
 * rather than once at module load: design doc's own illustrative snippet
 * caches `{width, height}` as a module-level constant, but a TV app that
 * might run under the Vega virtual device (which can be resized, unlike a
 * physical Stick) or migrate to a differently-configured display should
 * not carry a stale reading from whenever this module first happened to be
 * imported. The cost is one extra native-bridge call per invocation, which
 * is immaterial next to correctness here.
 *
 * R14 (design doc §9.2) is still open: it is unverified whether
 * `Dimensions.get('window')` reports raw device pixels (so a 1080p panel
 * reports 1920x1080 and this file's ratio math is exact) or
 * density-independent points at some non-1 scale factor (in which case
 * `BASE_WIDTH`/`BASE_HEIGHT` below would need to change to match whatever
 * unit `width`/`height` turn out to be in -- e.g. dividing both by the
 * same reported `PixelRatio.get()`). Isolated to these two constants
 * specifically so that, per this file's own one-line-fix philosophy, R14
 * resolving either way is a two-number edit here, not a rewrite of every
 * screen that calls `sw`/`sh`.
 */
import {Dimensions, PixelRatio} from 'react-native';

const BASE_WIDTH = 1920;
const BASE_HEIGHT = 1080;

/** Scales a horizontal measurement (in CSS-pixel-equivalent units, at the 1920-wide baseline) to this device's real width. */
export function sw(value: number): number {
  const {width} = Dimensions.get('window');
  return PixelRatio.roundToNearestPixel((width / BASE_WIDTH) * value);
}

/** Scales a vertical measurement (in CSS-pixel-equivalent units, at the 1080-tall baseline) to this device's real height. */
export function sh(value: number): number {
  const {height} = Dimensions.get('window');
  return PixelRatio.roundToNearestPixel((height / BASE_HEIGHT) * value);
}

/**
 * Scales a value uniformly by width -- for anything that should keep its
 * proportions rather than stretch independently on each axis (a font size,
 * a corner radius, an icon's diameter). Uses width rather than an average
 * of both axes because a TV's aspect ratio is overwhelmingly always 16:9;
 * "uniform" and "scale by width" coincide in practice.
 */
export function sf(value: number): number {
  return sw(value);
}
