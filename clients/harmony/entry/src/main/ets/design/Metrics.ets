/**
 * Resolves the TV (1920x1080 vp design space) or touch metric table from
 * the live device profile (brief sections 5.9/5.10/6.2).
 *
 * `device/DeviceProfileService.ets` (a parallel slice of this workflow)
 * reads `deviceInfo.deviceType` + window size, resolves a `DeviceProfile`
 * via `core/DeviceProfile.ts`, and publishes the result into `AppStorage`
 * under the key named by `DEVICE_PROFILE_STORAGE_KEY` below. This file
 * only ever *reads* that key -- it does not detect the device itself.
 *
 * ## The TV coordinate space (brief 6.2)
 *
 * Android fixes `densityDpi = 160` for TV so every `.dp` literal in a TV
 * branch is a Playarr-Web CSS pixel on a fixed 1920x1080 canvas.
 * HarmonyOS has no equivalent density pin, so instead: every numeric field
 * in `core/Tokens.ts`'s `TvGeometry` table is a literal vp value *at*
 * 1920x1080, and must be scaled by `k = windowWidthVp / 1920` before use
 * on a real (differently sized) TV panel. `tv(n)` below is that scaling
 * function -- wrap every `TvGeometry` numeric field in it at the call
 * site, e.g. `Text().fontSize(tv(TvGeometry.railHeadingSize))`.
 *
 * `k` itself is read live from the AppStorage key named by
 * `TV_SCALE_FACTOR_STORAGE_KEY` ('tvScaleFactor'). That key name is NOT
 * documented anywhere else in the implementation brief -- it is this
 * file's own choice, made because brief 6.2 leaves the mechanism up to
 * whichever file owns `design/Metrics.ets`. **`device/DeviceProfileService.ets`
 * must publish the live `windowWidthVp / 1920` ratio under this exact key**
 * (recomputed on every window-size change, alongside the `DeviceProfile`
 * it already publishes) for `tv()` to do anything other than pass values
 * through unscaled.
 */

import type { DeviceProfile } from '../core/DeviceProfile';
import { TvGeometry, TouchGeometry } from '../core/Tokens';
import type { TvGeometryTokens, TouchGeometryTokens } from '../core/Tokens';

/** Published by `device/DeviceProfileService.ets`; read-only from here. */
export const DEVICE_PROFILE_STORAGE_KEY: string = 'deviceProfile';

/** Published by `device/DeviceProfileService.ets` as `windowWidthVp / 1920`,
 * recomputed on every window-size change. See this file's header comment. */
export const TV_SCALE_FACTOR_STORAGE_KEY: string = 'tvScaleFactor';

/** Re-exported so most call sites only need to import from `design/Metrics`
 * rather than reaching back into `core/Tokens` directly. */
export { TvGeometry, TouchGeometry };

/** The current device profile's metrics table selector. Falls back to
 * `'touch'` if `device/DeviceProfileService.ets` has not published yet
 * (e.g. the very first frame before ability creation completes). */
export function activeMetricsKey(): 'tv' | 'touch' {
  const profile = AppStorage.get<DeviceProfile>(DEVICE_PROFILE_STORAGE_KEY);
  if (profile !== undefined) {
    return profile.metricsKey;
  }
  return 'touch';
}

/** Convenience boolean form of `activeMetricsKey()`. */
export function isTvMetrics(): boolean {
  return activeMetricsKey() === 'tv';
}

/**
 * The active metric table for the current device profile. Because
 * `TvGeometryTokens` and `TouchGeometryTokens` share only a handful of
 * identically-named fields (`homeRailCardWidthLandscape`,
 * `homeRailCardWidthCover`, `railHeadingSize`, `playerAutoHideMs`), this
 * union return type only lets a caller read those shared fields directly
 * without narrowing -- exactly the fields the brief deliberately kept
 * same-named across both tables (5.10) so a shared component can read them
 * profile-agnostically. A component that is itself TV-only (`Stage.ets`,
 * `NavRail.ets`, the rail-panel/A-Z index metrics) or touch-only
 * (`NavPill.ets`) should import `TvGeometry`/`TouchGeometry` directly
 * instead, since its profile-exclusive fields are not on this union.
 */
export function activeGeometry(): TvGeometryTokens | TouchGeometryTokens {
  return isTvMetrics() ? TvGeometry : TouchGeometry;
}

/** The live `windowWidthVp / 1920` TV scale factor (brief 6.2), or `1` if
 * `device/DeviceProfileService.ets` has not published one yet (e.g. on the
 * touch profile, where TV geometry is never rendered, or before the first
 * window-size measurement lands). */
export function tvScaleFactor(): number {
  const k = AppStorage.get<number>(TV_SCALE_FACTOR_STORAGE_KEY);
  if (k !== undefined && k > 0) {
    return k;
  }
  return 1;
}

/** Scales a raw `TvGeometry` literal (baked at 1920x1080 vp) by the live
 * `windowWidthVp / 1920` ratio. Every `TvGeometry` field consumed by a
 * TV-profile component must be wrapped in this, never used raw. */
export function tv(n: number): number {
  return n * tvScaleFactor();
}
